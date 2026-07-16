import { runs, task, tasks } from "@trigger.dev/sdk"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getWorkerSecret, workerConvexClient } from "@/lib/codex/run-worker"
import { queueFactoryWakeRuns } from "@/lib/factory/wake-dispatch"
import { createWorkerGitHubRepoCredential } from "@/lib/github/app-worker"
import { canClonePublicGitHubRepo } from "@/lib/github/repo-api"
import {
  deleteSlackMessage,
  findSlackMessageByDedupeKey,
  isDefiniteSlackRejection,
  postSlackMessage,
} from "@/lib/integrations/outbound"
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

const WAIT_ARM_POST_ATTEMPTS = 3
const WAIT_ARM_MUTATION_ATTEMPTS = 4
const WAIT_ARM_RECONCILE_ATTEMPTS = 3
const WAIT_ARM_RETRY_BASE_DELAY_MS = 1_000

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

async function withArmRetries<T>(
  attempts: number,
  operation: () => Promise<T>
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, WAIT_ARM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
        )
      }
    }
  }
  throw lastError
}

/** Resolves an ambiguous post outcome against channel history using the
 * wait-scoped dedupe key stamped in the message metadata. Distinguishes
 * three results: the accepted message was found, its absence was positively
 * confirmed by an exhausted lookup, or nothing about delivery is known
 * (lookup failed, or the range was too busy to search completely). */
async function reconcilePostedQuestion(
  ref: { slackTeamId: string },
  payload: FactoryWaitArmPayload,
  oldestTs: string
): Promise<{ accepted: { ts: string } | null; confirmedAbsent: boolean }> {
  let lastError: unknown
  for (let attempt = 1; attempt <= WAIT_ARM_RECONCILE_ATTEMPTS; attempt += 1) {
    try {
      const { exhausted, found } = await findSlackMessageByDedupeKey(ref, {
        channel: payload.channelId,
        dedupeKey: payload.waitId!,
        oldestTs,
        threadTs: payload.threadTs,
      })
      return { accepted: found, confirmedAbsent: !found && exhausted }
    } catch (error) {
      lastError = error
      if (attempt < WAIT_ARM_RECONCILE_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, WAIT_ARM_RETRY_BASE_DELAY_MS * attempt)
        )
      }
    }
  }
  console.warn("Unable to reconcile ambiguous Slack post.", lastError)
  return { accepted: null, confirmedAbsent: false }
}

/** Posts the question at-most-once per wait: a definite Slack rejection is
 * safe to retry, but after an ambiguous transport failure (the response was
 * lost) another post is only issued once a successful history lookup has
 * positively confirmed non-delivery. If delivery can be neither confirmed
 * nor ruled out, the post fails rather than risking a duplicate question a
 * human might answer while the wait watches a different copy. */
async function postSlackQuestion(
  payload: FactoryWaitArmPayload
): Promise<{ ts: string }> {
  const ref = { slackTeamId: payload.slackTeamId }
  const message = {
    channel: payload.channelId,
    dedupeKey: payload.waitId,
    markdown: payload.markdown,
    threadTs: payload.threadTs,
  }
  const oldestTs = String(Math.floor((Date.now() - 15 * 60_000) / 1000))

  let lastError: unknown
  for (let attempt = 1; attempt <= WAIT_ARM_POST_ATTEMPTS; attempt += 1) {
    try {
      return await postSlackMessage(ref, message)
    } catch (error) {
      lastError = error
      if (payload.waitId && !isDefiniteSlackRejection(error)) {
        const reconciled = await reconcilePostedQuestion(ref, payload, oldestTs)
        if (reconciled.accepted) return reconciled.accepted
        if (!reconciled.confirmedAbsent) {
          throw new Error(
            `The Slack response was lost and delivery could not be verified, so the question was not re-posted: ${errorMessage(error)}`
          )
        }
      }
      if (attempt < WAIT_ARM_POST_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, WAIT_ARM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
        )
      }
    }
  }
  throw lastError
}

// Posts an agent-authored Slack message on behalf of the ask_human and
// slack_post_message tools. Provider SDKs (and the OAuth bot tokens in the
// Chat SDK state store) live in Trigger workers, not Convex, so the Convex
// action creates the wait in "arming" and this task confirms the post and
// arms it with the message timestamp.
//
// The task runs a single Trigger attempt and manages retries itself: the
// post converges on one accepted message (see postSlackQuestion), and the
// arm mutation retries separately afterwards. A task-level retry would
// re-run the whole body and could post the question a second time. Either
// stage exhausting its retries fails the wait and wakes the agent, so a
// question is never silently lost.
//
// Accepted limitation: the question is visible in Slack for the seconds
// between the post and the arm mutation committing its match keys, so a
// reply or reaction landing inside that window is never recorded and the
// wait resolves as an ordinary timeout. Humans do not answer in seconds;
// closing the window would need a post-arm history reconciliation sweep
// feeding gap events through recording — more machinery than the window
// warrants.
export const factoryWaitArm = task({
  id: "factory-wait-arm",
  retry: {
    maxAttempts: 1,
  },
  run: async (rawPayload: FactoryWaitArmPayload | string) => {
    const payload = resolveWaitArmPayload(rawPayload)
    const client = workerConvexClient()
    const workerSecret = getWorkerSecret()

    const failWait = async (error: string) => {
      if (!payload.waitId) return
      const failed = await client
        .mutation(api.factoryWaits.workerFailWaitArm, {
          error,
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

    // A task starting late — after the wait was canceled, expired, or failed
    // by the orphan sweep — must not post a question nobody is listening
    // for. Best-effort: if the state read fails, posting stays the priority.
    if (payload.waitId) {
      const state = await client
        .query(api.factoryWaits.workerGetWaitState, {
          waitId: payload.waitId,
          workerSecret,
        })
        .catch(() => null)
      if (state && state.status !== "arming") {
        return { posted: false, reason: state.status }
      }
    }

    let posted: { ts: string }
    try {
      posted = await postSlackQuestion(payload)
    } catch (error) {
      await failWait(
        `The Slack message could not be posted: ${errorMessage(error)}.`
      )
      throw error
    }

    if (payload.waitId) {
      // Shared by every arm-failure path: a question whose wait cannot be
      // armed is unanswerable, so retract it rather than invite replies that
      // can never wake the agent. Best-effort — when arming failed because
      // Convex is down, this Slack call is the only cleanup still possible.
      const retractQuestion = async () => {
        await deleteSlackMessage(
          { slackTeamId: payload.slackTeamId },
          { channel: payload.channelId, ts: posted.ts }
        ).catch((deleteError) => {
          console.warn(
            "Unable to retract orphaned Slack question.",
            deleteError
          )
        })
      }

      let armed: { armed: boolean }
      try {
        armed = await withArmRetries(WAIT_ARM_MUTATION_ATTEMPTS, () =>
          client.mutation(api.factoryWaits.workerArmWait, {
            channelId: payload.channelId,
            messageTs: posted.ts,
            threadTs: payload.threadTs,
            waitId: payload.waitId!,
            workerSecret,
          })
        )
      } catch (error) {
        await retractQuestion()
        await failWait(
          `The question was posted to Slack but the wait could not be armed, so the question was retracted: ${errorMessage(error)}.`
        )
        throw error
      }

      if (!armed.armed) {
        // The wait went terminal between the post and the arm (canceled,
        // expired, or swept).
        await retractQuestion()
        return { armed: false, posted: true, ts: posted.ts }
      }
    }

    return { armed: Boolean(payload.waitId), posted: true, ts: posted.ts }
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
