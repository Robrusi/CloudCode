import type { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  isGitHubAppConfigured,
  isGitHubAppUserAuthConfigured,
} from "@/lib/github/app-client"
import { resolveGitHubAppUserAuth } from "@/lib/github/app"
import {
  createGitHubAppRepoCredentialForInstallations,
  getGitHubAppRepoInstallation,
} from "@/lib/github/app-repositories"
import type { GitHubRepoCredential } from "@/lib/github/app-types"
import { getWorkerSecret } from "@/lib/security/worker-secret"

const GITHUB_APP_WORKER_SECRET_ERROR =
  "Set TRIGGER_WORKER_SECRET before using worker-side GitHub App auth."

// Headless equivalent of maybeGetCurrentGitHubRepoCredential: mints a GitHub
// App installation token for a user without a browser session. Uses the
// stored installations instead of re-syncing them from GitHub; syncing stays
// an interactive concern.
export async function createWorkerGitHubRepoCredential(
  client: ConvexHttpClient,
  input: { repoUrl: string; userId: Id<"users"> }
): Promise<GitHubRepoCredential | null> {
  if (!isGitHubAppConfigured() || !isGitHubAppUserAuthConfigured()) return null

  const workerSecret = getWorkerSecret(GITHUB_APP_WORKER_SECRET_ERROR)
  const stored = await client.query(api.githubApp.getUserAuthForWorker, {
    userId: input.userId,
    workerSecret,
  })
  const userAuth = await resolveGitHubAppUserAuth(stored, async (fields) => {
    await client.mutation(api.githubApp.saveUserAuthForWorker, {
      ...fields,
      userId: input.userId,
      workerSecret,
    })
  })
  if (!userAuth) return null

  const repoInstallation = await getGitHubAppRepoInstallation(input.repoUrl)
  if (!repoInstallation) return null

  const installations = await client.query(
    api.githubApp.installationsForWorker,
    {
      userId: input.userId,
      workerSecret,
    }
  )

  return await createGitHubAppRepoCredentialForInstallations({
    installations,
    repoInstallation,
    userAuth,
  })
}
