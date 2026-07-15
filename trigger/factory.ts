import { runs, task, tasks } from "@trigger.dev/sdk"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getWorkerSecret, workerConvexClient } from "@/lib/codex/run-worker"
import { queueFactoryWakeRuns } from "@/lib/factory/wake-dispatch"
import { createWorkerGitHubRepoCredential } from "@/lib/github/app-worker"
import { canClonePublicGitHubRepo } from "@/lib/github/repo-api"
import { postSlackMessage } from "@/lib/integrations/outbound"
import { deleteWorkerDaytonaSandbox } from "@/lib/sandbox/delete"
import { encryptSecret } from "@/lib/security/secret-crypto"
import type { cloudcodeRun } from "@/trigger/cloudcode-run"

const GITHUB_ACCESS_ERROR =
  "Install the GitHub App on this repository and authorize your GitHub user, or use a public GitHub repository."

type FactoryDispatchPayload = {
  runId: Id<"codexRuns">
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Factory dispatch failed."
}

/** Payloads arrive via the SDK (object) or the public REST API from Convex;
 * tolerate a string-encoded payload so an encoding mismatch can never strand
 * queued work. */
function resolveFactoryPayload<T extends { runId: string }>(
  payload: T | string,
  taskLabel: string
): T {
  const resolved =
    typeof payload === "string" ? (JSON.parse(payload) as T) : payload
  if (!resolved || typeof resolved.runId !== "string" || !resolved.runId) {
    throw new Error(`${taskLabel} payload is missing runId.`)
  }
  return resolved
}

// Completes a run created by the factory MCP tools: the Convex action already
// created the thread/run rows, but only this Trigger-side task can mint the
// GitHub App installation token and hand off to the regular cloudcode-run
// pipeline. Kept separate so the tool call returns the child run id
// immediately instead of waiting on GitHub.
export const factoryDispatch = task({
  id: "factory-dispatch",
  retry: {
    maxAttempts: 1,
  },
  run: async (rawPayload: FactoryDispatchPayload | string) => {
    const payload = resolveFactoryPayload(rawPayload, "factory-dispatch")
    const client = workerConvexClient()
    const workerSecret = getWorkerSecret()

    const failDispatch = async (error: string) => {
      await client
        .mutation(api.factory.workerFailDispatch, {
          error,
          runId: payload.runId,
          workerSecret,
        })
        .catch((failError) => {
          console.warn("Unable to mark dispatched run failed.", failError)
        })
    }

    const run = await client.query(api.factory.workerGetDispatchRun, {
      runId: payload.runId,
      workerSecret,
    })
    if (!run) return { dispatched: false, reason: "not_found" as const }
    // Redeliveries and runs the user canceled while queued must not restart.
    if (run.status !== "queued") {
      return { dispatched: false, reason: "not_queued" as const }
    }

    try {
      const credential = await createWorkerGitHubRepoCredential(client, {
        repoUrl: run.repoUrl,
        userId: run.userId,
      })
      if (credential?.token) {
        await client.mutation(api.factory.workerAttachDispatchCredential, {
          githubToken: encryptSecret(credential.token),
          githubUserEmail: credential.gitUserEmail,
          githubUserName: credential.gitUserName,
          githubUsername: credential.username ?? undefined,
          runId: payload.runId,
          workerSecret,
        })
      } else if (!(await canClonePublicGitHubRepo(run.repoUrl))) {
        await failDispatch(GITHUB_ACCESS_ERROR)
        return { dispatched: false, reason: "github_access" as const }
      }

      const handle = await tasks.trigger<typeof cloudcodeRun>(
        "cloudcode-run",
        { runId: payload.runId },
        {
          idempotencyKey: payload.runId,
          tags: [`user:${run.userId}`, `thread:${run.threadId}`],
        }
      )
      const attached = await client.mutation(
        api.codexRuns.workerAttachTriggerRun,
        {
          runId: payload.runId,
          triggerRunId: handle.id,
          workerSecret,
        }
      )
      if (attached.canceled) {
        // Canceled in the window between creation and trigger attachment;
        // cancel the queued Trigger run so it cannot wake up later.
        await runs.cancel(handle.id).catch((cancelError) => {
          console.warn("Unable to cancel queued Trigger.dev run.", cancelError)
        })
        return { dispatched: false, reason: "canceled" as const }
      }

      return { dispatched: true, triggerRunId: handle.id }
    } catch (error) {
      await failDispatch(errorMessage(error))
      throw error
    }
  },
})

type FactoryWaitArmPayload = {
  channelId: string
  markdown: string
  slackTeamId: string
  threadTs?: string
  // Absent for post-only sends (the slack_post_message tool).
  waitId?: Id<"factoryWaits">
}

const WAIT_ARM_MAX_ATTEMPTS = 3

function resolveWaitArmPayload(
  payload: FactoryWaitArmPayload | string
): FactoryWaitArmPayload {
  const resolved =
    typeof payload === "string"
      ? (JSON.parse(payload) as FactoryWaitArmPayload)
      : payload
  if (
    !resolved ||
    typeof resolved.channelId !== "string" ||
    !resolved.channelId ||
    typeof resolved.markdown !== "string" ||
    !resolved.markdown
  ) {
    throw new Error("factory-wait-arm payload is incomplete.")
  }
  return resolved
}

// Posts an agent-authored Slack message on behalf of the ask_human and
// slack_post_message tools. Provider SDKs (and the OAuth bot tokens in the
// Chat SDK state store) live in Trigger workers, not Convex, so the Convex
// action creates the wait in "arming" and this task confirms the post and
// arms it with the message timestamp. A post that exhausts its retries fails
// the wait and wakes the agent so a question is never silently lost.
export const factoryWaitArm = task({
  id: "factory-wait-arm",
  retry: {
    maxAttempts: WAIT_ARM_MAX_ATTEMPTS,
  },
  run: async (rawPayload: FactoryWaitArmPayload | string, { ctx }) => {
    const payload = resolveWaitArmPayload(rawPayload)
    const client = workerConvexClient()
    const workerSecret = getWorkerSecret()

    try {
      const posted = await postSlackMessage(
        { slackTeamId: payload.slackTeamId },
        {
          channel: payload.channelId,
          markdown: payload.markdown,
          threadTs: payload.threadTs,
        }
      )

      if (payload.waitId) {
        await client.mutation(api.factoryWaits.workerArmWait, {
          channelId: payload.channelId,
          messageTs: posted.ts,
          threadTs: payload.threadTs,
          waitId: payload.waitId,
          workerSecret,
        })
      }
      return { posted: true, ts: posted.ts }
    } catch (error) {
      if (ctx.attempt.number < WAIT_ARM_MAX_ATTEMPTS) throw error

      if (payload.waitId) {
        const failed = await client
          .mutation(api.factoryWaits.workerFailWaitArm, {
            error:
              error instanceof Error ? error.message : "The Slack post failed.",
            notify: true,
            waitId: payload.waitId,
            workerSecret,
          })
          .catch((failError) => {
            console.warn("Unable to mark wait arm failed.", failError)
            return undefined
          })
        await queueFactoryWakeRuns(failed?.factoryWakeRuns)
      }
      throw error
    }
  },
})

type FactorySandboxDeletePayload = {
  runId: Id<"codexRuns">
  sandboxId: string
  userId: Id<"users">
}

// Deletes a dispatched thread's retained sandbox on behalf of the factory
// sandbox_delete tool: Daytona deletion + billing segment end via the shared
// worker helper, then the run/thread sandbox pointers are cleared so the UI
// and later runs know it is gone.
export const factorySandboxDelete = task({
  id: "factory-sandbox-delete",
  retry: {
    maxAttempts: 1,
  },
  run: async (rawPayload: FactorySandboxDeletePayload | string) => {
    const payload = resolveFactoryPayload(
      rawPayload,
      "factory-sandbox-delete"
    ) as FactorySandboxDeletePayload
    if (!payload.sandboxId || !payload.userId) {
      throw new Error("factory-sandbox-delete payload is incomplete.")
    }

    const client = workerConvexClient()
    await deleteWorkerDaytonaSandbox(client, {
      sandboxId: payload.sandboxId,
      userId: payload.userId,
    })
    await client.mutation(api.codexRuns.workerMarkSandboxDeleted, {
      runId: payload.runId,
      sandboxId: payload.sandboxId,
      workerSecret: getWorkerSecret(),
    })

    return { deleted: true, sandboxId: payload.sandboxId }
  },
})
