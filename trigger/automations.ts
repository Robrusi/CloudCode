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
  eventQueueId?: Id<"automationEventQueue">
  manual: boolean
  scheduledFor?: number
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Automation run failed."
}

/** Idempotently bridges a persisted Codex run to its Trigger.dev worker. If
 * the caller dies anywhere in this handoff, the queue's run_created state lets
 * the minute tick retry it without creating another Codex run. */
async function dispatchCreatedAutomationRun(args: {
  automationId: Id<"automations">
  eventQueueId?: Id<"automationEventQueue">
  runId: Id<"codexRuns">
  userId: Id<"users">
}) {
  const client = workerConvexClient()
  const workerSecret = getWorkerSecret()
  const handle = await tasks.trigger<typeof cloudcodeRun>(
    "cloudcode-run",
    { runId: args.runId },
    {
      idempotencyKey: args.runId,
      tags: [`user:${args.userId}`, `automation:${args.automationId}`],
    }
  )
  const attached = await client.mutation(api.codexRuns.workerAttachTriggerRun, {
    runId: args.runId,
    triggerRunId: handle.id,
    workerSecret,
  })
  if (args.eventQueueId) {
    await client.mutation(api.automations.workerCompleteQueuedEvent, {
      queueId: args.eventQueueId,
      workerSecret,
    })
  }
  return {
    dispatched: true as const,
    runId: args.runId,
    triggerRunId: attached.triggerRunId,
  }
}

// Every minute: claim due automations (compare-and-set on nextRunAt, so
// overlapping ticks dispatch each slot exactly once) and sweep sandboxes
// leaked by crashed ephemeral runs.
export const automationsTick = schedules.task({
  id: "automations-tick",
  cron: "*/1 * * * *",
  retry: {
    factor: 2,
    maxAttempts: 3,
    maxTimeoutInMs: 10_000,
    minTimeoutInMs: 1_000,
    randomize: true,
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
          .mutation(api.automations.releaseScheduleClaimForWorker, {
            automationId: automation._id,
            expectedNextRunAt: next,
            scheduledFor: claim.scheduledFor,
            workerSecret,
          })
          .catch((releaseError) => {
            console.warn(
              "Unable to restore failed schedule claim.",
              releaseError
            )
          })
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

    const recovered = await client.mutation(
      api.automations.workerRecoverEventQueues,
      { now, workerSecret }
    )
    for (const automationId of recovered.automationIds) {
      await tasks
        .trigger<typeof automationEventDispatch>(
          "automation-event-dispatch",
          { automationId },
          {
            idempotencyKey: `${automationId}:recover:${Math.floor(now / 60_000)}`,
            tags: [`automation:${automationId}`],
          }
        )
        .catch((error) => {
          console.warn("Unable to recover queued automation event.", error)
        })
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

    return {
      dispatched,
      due: due.length,
      recoveredEventQueues: recovered.recovered,
      sweptSandboxes: leaked.length,
    }
  },
})

/** Starts exactly one persisted event for an idle automation. Completion of
 * the resulting Codex run schedules the next drain; the minute tick recovers
 * a lease if this worker dies between the claim and child enqueue. */
export const automationEventDispatch = task({
  id: "automation-event-dispatch",
  retry: {
    factor: 2,
    maxAttempts: 5,
    maxTimeoutInMs: 30_000,
    minTimeoutInMs: 1_000,
    randomize: true,
  },
  run: async (payload: { automationId: Id<"automations"> }) => {
    const client = workerConvexClient()
    const workerSecret = getWorkerSecret()
    const claim = await client.mutation(
      api.automations.workerClaimQueuedEvent,
      { automationId: payload.automationId, workerSecret }
    )
    if (!claim.claimed) {
      if (claim.reason === "run_created") {
        return await dispatchCreatedAutomationRun({
          automationId: payload.automationId,
          eventQueueId: claim.queueId,
          runId: claim.runId,
          userId: claim.userId,
        })
      }
      return claim
    }

    try {
      const handle = await tasks.trigger<typeof automationRun>(
        "automation-run",
        {
          automationId: payload.automationId,
          eventQueueId: claim.queueId,
          eventVars: claim.eventVars,
          manual: false,
        },
        {
          idempotencyKey: `automation-event:${claim.queueId}`,
          tags: [`automation:${payload.automationId}`],
        }
      )
      return { dispatched: true, triggerRunId: handle.id }
    } catch (error) {
      await client
        .mutation(api.automations.workerReleaseQueuedEvent, {
          queueId: claim.queueId,
          workerSecret,
        })
        .catch((releaseError) => {
          console.warn(
            "Unable to release queued automation event.",
            releaseError
          )
        })
      throw error
    }
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

    const releaseQueuedEvent = async () => {
      if (!payload.eventQueueId) return
      await client.mutation(api.automations.workerReleaseQueuedEvent, {
        queueId: payload.eventQueueId,
        workerSecret,
      })
    }
    const completeQueuedEvent = async () => {
      if (!payload.eventQueueId) return
      await client.mutation(api.automations.workerCompleteQueuedEvent, {
        queueId: payload.eventQueueId,
        workerSecret,
      })
    }
    const queueNextEvent = async () => {
      if (!payload.eventQueueId) return
      await tasks
        .trigger<typeof automationEventDispatch>(
          "automation-event-dispatch",
          { automationId: payload.automationId },
          {
            idempotencyKey: `${payload.automationId}:after:${payload.eventQueueId}`,
            tags: [`automation:${payload.automationId}`],
          }
        )
        .catch((error) => {
          console.warn("Unable to drain the next automation event.", error)
        })
    }

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
    if (!loaded) {
      await completeQueuedEvent()
      return { dispatched: false, reason: "not_found" as const }
    }

    const { automation } = loaded
    if (!automation.enabled && !payload.manual) {
      await completeQueuedEvent()
      return { dispatched: false, reason: "disabled" as const }
    }
    if (loaded.activeRun) {
      if (payload.eventQueueId) {
        await releaseQueuedEvent()
        return { dispatched: false, reason: "queued_behind_active" as const }
      }
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
        await completeQueuedEvent()
        await queueNextEvent()
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
        await completeQueuedEvent()
        await queueNextEvent()
        return { dispatched: false, reason: "github_access" as const }
      }

      const result = await client.mutation(api.automations.workerCreateRun, {
        automationId: payload.automationId,
        eventQueueId: payload.eventQueueId,
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
          if (payload.eventQueueId) {
            await releaseQueuedEvent()
            return {
              dispatched: false,
              reason: "queued_behind_active" as const,
            }
          }
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
        await completeQueuedEvent()
        await queueNextEvent()
        return { dispatched: false, reason: result.status }
      }
      created = result
    } catch (error) {
      await recordDispatchFailure(errorMessage(error))
      await releaseQueuedEvent().catch(() => undefined)
      throw error
    }

    // Event runs remain recoverable in run_created until the worker handoff is
    // durably attached. Cron/manual runs have no queue backstop, so preserve
    // their existing explicit failure cleanup.
    try {
      return await dispatchCreatedAutomationRun({
        automationId: payload.automationId,
        eventQueueId: payload.eventQueueId,
        runId: created.runId,
        userId: created.userId,
      })
    } catch (error) {
      if (payload.eventQueueId) throw error
      await failWorkerRun(client, created.runId, errorMessage(error)).catch(
        (failError) => {
          console.warn("Unable to mark automation run failed.", failError)
        }
      )
      await queueNextEvent()
      throw error
    }
  },
})
