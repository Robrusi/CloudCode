import {
  getCurrentGitHubAppStatus,
  maybeCreateGitHubAppRepoCredential,
  type GitHubRepoCredential,
} from "@/lib/github-app"

export type GitHubAuthStatus = {
  app: Awaited<ReturnType<typeof getCurrentGitHubAppStatus>>
  connected: boolean
  mode: "app" | "none"
  username?: string | null
}

export async function getCurrentGitHubAuthStatus() {
  const app = await getCurrentGitHubAppStatus()
  const connected = app.user.connected && app.installations.length > 0

  return {
    app,
    connected,
    mode: connected ? "app" : "none",
    username: app.user.connected ? app.user.login : undefined,
  } satisfies GitHubAuthStatus
}

export async function maybeGetCurrentGitHubRepoCredential(
  repoUrl: string
): Promise<GitHubRepoCredential | null> {
  return maybeCreateGitHubAppRepoCredential(repoUrl)
}
