import { schedules, task, tasks } from "@trigger.dev/sdk"
import { randomUUID } from "node:crypto"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { nextRunAtAfter } from "@/lib/automations/schedule"
import {
  failWorkerRun,
  getWorkerSecret,
  workerConvexClient,
} from "@/lib/codex/run-worker"
import { createWorkerGitHubRepoCredential } from "@/lib/github/app-worker"
import { canClonePublicGitHubRepo } from "@/lib/github/repo-api"
import {
  applyEventContext,
  type EventContextVars,
} from "@/lib/integrations/events"
import { deleteWorkerDaytonaSandbox } from "@/lib/sandbox/delete"
import { encryptSecret } from "@/lib/security/secret-crypto"
import type { cloudcodeRun } from "@/trigger/cloudcode-run"

const DUE_AUTOMATIONS_PER_TICK = 25

const INVALID_SCHEDULE_REASON =
  "Invalid schedule. Edit the automation to fix its cron expression."
const BILLING_EXHAUSTED_ERROR =
  "Infrastructure usage is exhausted. Upgrade to Hobby or Plus, or wait for your included usage to reset."
const GITHUB_ACCESS_ERROR =
  "Install the GitHub App on this repository and authorize your GitHub user, or use a public GitHub repository."

type AutomationRunPayload = {
  automationId: Id<"automations">
  // Set on event-triggered fires (GitHub/Slack/Linear): interpolated into the
  // automation's prompt as {{event.*}} plus an appended context block.
  eventVars?: EventContextVars
  manual: boolean
  scheduledFor?: number
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Automation run failed."
}

// Every minute: claim due automations (compare-and-set on nextRunAt, so
// overlapping ticks dispatch each slot exactly once) and sweep sandboxes
// leaked by crashed ephemeral runs.
export const automationsTick = schedules.task({
  id: "automations-tick",
  cron: "*/1 * * * *",
  retry: {
    maxAttempts: 1,
  },
  run: async () => {
    const client = workerConvexClient()
    const workerSecret = getWorkerSecret()
    const now = Date.now()

    const due = await client.query(api.automations.dueForWorker, {
      limit: DUE_AUTOMATIONS_PER_TICK,
      now,
      workerSecret,
    })

    let dispatched = 0
    for (const automation of due) {
      let next: number
      try {
        // From now, not from the missed slot: downtime never causes a
        // backfill storm, the automation just fires once and moves on.
        next = nextRunAtAfter(automation.cron, automation.timezone, now)
      } catch (error) {
        console.warn("Disabling automation with invalid schedule.", error)
        await client
          .mutation(api.automations.disableForWorker, {
            automationId: automation._id,
            reason: INVALID_SCHEDULE_REASON,
            workerSecret,
          })
          .catch((disableError) => {
            console.warn("Unable to disable automation.", disableError)
          })
        continue
      }

      const claim = await client.mutation(api.automations.claimForWorker, {
        automationId: automation._id,
        expectedNextRunAt: automation.nextRunAt,
        nextRunAt: next,
        now,
        workerSecret,
      })
      if (!claim.claimed) continue

      try {
        await tasks.trigger<typeof automationRun>(
          "automation-run",
          {
            automationId: automation._id,
            manual: false,
            scheduledFor: claim.scheduledFor,
          },
          {
            idempotencyKey: `${automation._id}:${claim.scheduledFor}`,
            tags: [`user:${automation.userId}`, `automation:${automation._id}`],
          }
        )
        dispatched += 1
      } catch (error) {
        await client
          .mutation(api.automations.recordDispatchFailureForWorker, {
            automationId: automation._id,
            error: errorMessage(error),
            workerSecret,
          })
          .catch((recordError) => {
            console.warn("Unable to record dispatch failure.", recordError)
          })
      }
    }

    const leaked = await client.query(
      api.codexRuns.workerListLeakedEphemeralSandboxes,
      { now, workerSecret }
    )
    for (const leak of leaked) {
      await deleteWorkerDaytonaSandbox(client, {
        sandboxId: leak.sandboxId,
        userId: leak.userId,
      })
        .then(() =>
          client.mutation(api.codexRuns.workerMarkSandboxDeleted, {
            runId: leak.runId,
            sandboxId: leak.sandboxId,
            workerSecret,
          })
        )
        .catch((error) => {
          console.warn("Unable to sweep leaked ephemeral sandbox.", error)
        })
    }

    return { dispatched, due: due.length, sweptSandboxes: leaked.length }
  },
})

// Prepares and dispatches one automation run: guards (enabled, thread busy,
// billing), headless GitHub token mint, run + message creation in Convex,
// then hands off to the regular cloudcode-run pipeline.
export const automationRun = task({
  id: "automation-run",
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: AutomationRunPayload) => {
    const client = workerConvexClient()
    const workerSecret = getWorkerSecret()

    const recordDispatchFailure = async (error: string) => {
      await client
        .mutation(api.automations.recordDispatchFailureForWorker, {
          automationId: payload.automationId,
          error,
          workerSecret,
        })
        .catch((recordError) => {
          console.warn("Unable to record dispatch failure.", recordError)
        })
    }
    const recordSkip = async () => {
      await client
        .mutation(api.automations.recordSkipForWorker, {
          automationId: payload.automationId,
          workerSecret,
        })
        .catch((recordError) => {
          console.warn("Unable to record skipped run.", recordError)
        })
    }

    const loaded = await client.query(api.automations.getForWorker, {
      automationId: payload.automationId,
      workerSecret,
    })
    if (!loaded) return { dispatched: false, reason: "not_found" as const }

    const { automation } = loaded
    if (!automation.enabled && !payload.manual) {
      return { dispatched: false, reason: "disabled" as const }
    }
    if (loaded.activeRun) {
      await recordSkip()
      return { dispatched: false, reason: "previous_run_active" as const }
    }

    let created: { runId: Id<"codexRuns">; userId: Id<"users"> }
    try {
      const billing = await client.action(
        api.billing.checkInfraAccessForWorker,
        {
          userId: automation.userId,
          workerSecret,
        }
      )
      if (!billing.allowed) {
        await recordDispatchFailure(BILLING_EXHAUSTED_ERROR)
        return { dispatched: false, reason: "billing_exhausted" as const }
      }

      const credential = await createWorkerGitHubRepoCredential(client, {
        repoUrl: automation.repoUrl,
        userId: automation.userId,
      })
      if (
        !credential?.token &&
        !(await canClonePublicGitHubRepo(automation.repoUrl))
      ) {
        await recordDispatchFailure(GITHUB_ACCESS_ERROR)
        return { dispatched: false, reason: "github_access" as const }
      }

      const result = await client.mutation(api.automations.workerCreateRun, {
        automationId: payload.automationId,
        ...(credential?.token
          ? { githubToken: encryptSecret(credential.token) }
          : {}),
        githubUserEmail: credential?.gitUserEmail,
        githubUserName: credential?.gitUserName,
        githubUsername: credential?.username ?? undefined,
        manual: payload.manual,
        notesAccessToken: randomUUID(),
        ...(payload.eventVars
          ? {
              prompt: applyEventContext(automation.prompt, payload.eventVars),
            }
          : {}),
        workerSecret,
      })
      if (!result.ok) {
        if (result.status === "thread_busy") {
          await recordSkip()
          return { dispatched: false, reason: "previous_run_active" as const }
        }
        if (
          result.status === "missing_auth" ||
          result.status === "auth_reconnect_required"
        ) {
          await client
            .mutation(api.automations.disableForWorker, {
              automationId: payload.automationId,
              reason: result.message,
              workerSecret,
            })
            .catch((disableError) => {
              console.warn("Unable to disable automation.", disableError)
            })
          return { dispatched: false, reason: result.status }
        }
        return { dispatched: false, reason: result.status }
      }
      created = result
    } catch (error) {
      await recordDispatchFailure(errorMessage(error))
      throw error
    }

    // From here the run and its pending assistant message exist; failures
    // must unwind through workerFail so the thread is not left pending.
    try {
      const handle = await tasks.trigger<typeof cloudcodeRun>(
        "cloudcode-run",
        { runId: created.runId },
        {
          idempotencyKey: created.runId,
          tags: [
            `user:${created.userId}`,
            `automation:${payload.automationId}`,
          ],
        }
      )
      await client.mutation(api.codexRuns.workerAttachTriggerRun, {
        runId: created.runId,
        triggerRunId: handle.id,
        workerSecret,
      })

      return {
        dispatched: true,
        runId: created.runId,
        triggerRunId: handle.id,
      }
    } catch (error) {
      await failWorkerRun(client, created.runId, errorMessage(error)).catch(
        (failError) => {
          console.warn("Unable to mark automation run failed.", failError)
        }
      )
      throw error
    }
  },
})
