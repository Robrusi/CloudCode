import { tasks } from "@trigger.dev/sdk"
import type { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getWorkerSecret } from "@/lib/codex/run-worker"
import { createWorkerGitHubRepoCredential } from "@/lib/github/app-worker"
import { canClonePublicGitHubRepo } from "@/lib/github/repo-api"
import { encryptSecret } from "@/lib/security/secret-crypto"
import type { cloudcodeRun } from "@/trigger/cloudcode-run"

const GITHUB_ACCESS_ERROR =
  "Install the GitHub App on this repository and authorize your GitHub user, or use a public GitHub repository."

export type IntegrationRunToDispatch = {
  repoUrl: string
  runId: Id<"codexRuns">
  threadId: Id<"threads">
  userId: Id<"users">
}

/** Launches a queued integration run through the regular pipeline: mint the
 * headless GitHub credential, attach it, and hand off to cloudcode-run —
 * the same recipe as factory-dispatch. Throws with a user-postable message
 * when the repository is inaccessible; the run is marked failed first. */
export async function dispatchIntegrationRun(
  client: ConvexHttpClient,
  run: IntegrationRunToDispatch
) {
  const workerSecret = getWorkerSecret()

  const failDispatch = async (error: string) => {
    await client
      .mutation(api.factory.workerFailDispatch, {
        error,
        runId: run.runId,
        workerSecret,
      })
      .catch((failError) => {
        console.warn("Unable to mark integration run failed.", failError)
      })
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
        runId: run.runId,
        workerSecret,
      })
    } else if (!(await canClonePublicGitHubRepo(run.repoUrl))) {
      await failDispatch(GITHUB_ACCESS_ERROR)
      throw new Error(GITHUB_ACCESS_ERROR)
    }

    const handle = await tasks.trigger<typeof cloudcodeRun>(
      "cloudcode-run",
      { runId: run.runId },
      {
        idempotencyKey: run.runId,
        tags: [`user:${run.userId}`, `thread:${run.threadId}`],
      }
    )
    await client.mutation(api.codexRuns.workerAttachTriggerRun, {
      runId: run.runId,
      triggerRunId: handle.id,
      workerSecret,
    })
    return handle.id
  } catch (error) {
    if (!(error instanceof Error && error.message === GITHUB_ACCESS_ERROR)) {
      await failDispatch(
        error instanceof Error ? error.message : "Unable to start the run."
      )
    }
    throw error
  }
}
