import {
  githubAppRequest,
  githubUserRequest,
  type GitHubInstallationTokenResponse,
  type GitHubRepoInstallationResponse,
  type GitHubRepositoryResponse,
  type GitHubUserRepositoriesResponse,
} from "@/lib/github/app-client"
import { parseGitHubRepoUrl } from "@/lib/github/repo"
import type {
  GitHubAppRepository,
  GitHubAppUserAuth,
  GitHubRepoCredential,
  StoredGitHubAppInstallation,
} from "@/lib/github/app-types"
import { stringValue as optionalString } from "@/lib/shared/unknown-values"

export type GitHubAppRepoInstallation = {
  installationId: string
  owner: string
  repo: string
}

function normalizeRepository(
  installationId: string,
  data: GitHubRepositoryResponse
): GitHubAppRepository | null {
  const id =
    typeof data.id === "number" || typeof data.id === "string"
      ? String(data.id)
      : undefined
  const fullName = optionalString(data.full_name)
  const cloneUrl = optionalString(data.clone_url)
  const htmlUrl = optionalString(data.html_url)
  const name = optionalString(data.name)
  const ownerLogin = optionalString(data.owner?.login)

  if (!id || !fullName || !cloneUrl || !htmlUrl || !name || !ownerLogin) {
    return null
  }

  return {
    cloneUrl,
    defaultBranch: optionalString(data.default_branch),
    fullName,
    htmlUrl,
    id,
    installationId,
    name,
    ownerLogin,
    ownerType: optionalString(data.owner?.type),
    private: data.private === true,
  }
}

async function createGitHubInstallationAccessToken({
  installationId,
  permissions,
  repositoryIds,
  repositories,
}: {
  installationId: string
  permissions?: Record<string, "read" | "write">
  repositoryIds?: number[]
  repositories?: string[]
}) {
  const body = {
    ...(permissions ? { permissions } : {}),
    ...(repositoryIds?.length ? { repository_ids: repositoryIds } : {}),
    ...(repositories?.length ? { repositories } : {}),
  }
  const response = await githubAppRequest<GitHubInstallationTokenResponse>(
    `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      ...(Object.keys(body).length ? { body: JSON.stringify(body) } : {}),
      method: "POST",
    }
  )

  if (typeof response.token !== "string" || !response.token) {
    throw new Error("GitHub did not return an installation token.")
  }

  return {
    expiresAt:
      typeof response.expires_at === "string" ? response.expires_at : undefined,
    token: response.token,
  }
}

export async function listGitHubAppInstallationRepositories(
  token: string,
  installationId: string
) {
  const repositories: GitHubAppRepository[] = []

  for (let page = 1; ; page += 1) {
    const data = await githubUserRequest<GitHubUserRepositoriesResponse>(
      token,
      `/user/installations/${encodeURIComponent(installationId)}/repositories?per_page=100&page=${page}`
    )
    const items = data.repositories ?? []

    for (const item of items) {
      const repository = normalizeRepository(installationId, item)
      if (repository) repositories.push(repository)
    }

    if (items.length < 100) break
  }

  return repositories
}

export async function getGitHubAppRepoInstallation(
  repoUrl: string
): Promise<GitHubAppRepoInstallation | null> {
  const repo = parseGitHubRepoUrl(repoUrl)
  if (!repo) return null

  const data = await githubAppRequest<GitHubRepoInstallationResponse>(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/installation`
  ).catch((error) => {
    if (error instanceof Error && error.message === "Not Found") return null
    throw error
  })
  if (!data) return null

  const installationId =
    typeof data.id === "number" || typeof data.id === "string"
      ? String(data.id)
      : undefined

  return installationId ? { ...repo, installationId } : null
}

function hasGitHubWritePermission(
  permissions: GitHubRepositoryResponse["permissions"]
) {
  return Boolean(
    permissions?.admin === true ||
    permissions?.maintain === true ||
    permissions?.push === true
  )
}

async function userRepoWriteAccess({
  owner,
  repo,
  token,
}: {
  owner: string
  repo: string
  token: string
}) {
  const data = await githubUserRequest<GitHubRepositoryResponse>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  ).catch((error) => {
    if (
      error instanceof Error &&
      (error.message === "Not Found" || error.message.includes("Not Found"))
    ) {
      return null
    }
    throw error
  })

  const repositoryId =
    typeof data?.id === "number"
      ? data.id
      : typeof data?.id === "string"
        ? Number(data.id)
        : NaN

  if (
    !data ||
    !Number.isFinite(repositoryId) ||
    !hasGitHubWritePermission(data.permissions)
  ) {
    return null
  }

  return { repositoryId }
}

function gitUserIdentity(userAuth: GitHubAppUserAuth) {
  return {
    gitUserEmail:
      userAuth.email ??
      `${userAuth.githubUserId}+${userAuth.login}@users.noreply.github.com`,
    gitUserName: userAuth.name ?? userAuth.login,
    username: userAuth.login,
  }
}

export async function createGitHubAppRepoCredentialForInstallations({
  installations,
  repoInstallation,
  userAuth,
}: {
  installations: StoredGitHubAppInstallation[]
  repoInstallation: GitHubAppRepoInstallation
  userAuth: GitHubAppUserAuth
}): Promise<GitHubRepoCredential | null> {
  const allowed = installations.some(
    (installation) =>
      installation.installationId === repoInstallation.installationId
  )
  if (!allowed) return null

  const repoAccess = await userRepoWriteAccess({
    owner: repoInstallation.owner,
    repo: repoInstallation.repo,
    token: userAuth.token,
  })
  if (!repoAccess) return null

  const installationToken = await createGitHubInstallationAccessToken({
    installationId: repoInstallation.installationId,
    permissions: {
      contents: "write",
      pull_requests: "write",
    },
    repositoryIds: [repoAccess.repositoryId],
  })

  return {
    expiresAt: installationToken.expiresAt,
    source: "app",
    token: installationToken.token,
    ...gitUserIdentity(userAuth),
  }
}
