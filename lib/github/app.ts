import { createHash } from "node:crypto"

import { api } from "@/convex/_generated/api"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import {
  deleteGitHubAppUserGrant,
  exchangeGitHubAppUserCode,
  githubAppRequest,
  githubUserRequest,
  isGitHubAppConfigured,
  isGitHubAppUserAuthConfigured,
  refreshGitHubAppUserToken,
  type GitHubAppInstallationResponse,
  type GitHubUserInstallationsResponse,
  type GitHubUserResponse,
} from "@/lib/github/app-client"
import {
  createGitHubAppRepoCredentialForInstallations,
  getGitHubAppRepoInstallation,
  listGitHubAppInstallationRepositories,
} from "@/lib/github/app-repositories"
import {
  buildGitHubAppAccounts,
  listGitHubAppUserOrganizations,
} from "@/lib/github/app-status"
import type {
  GitHubAppOrganization,
  GitHubAppRepository,
  GitHubAppStatus,
  GitHubAppUserAuth,
  GitHubAppUserStatus,
  GitHubDisconnectResult,
  GitHubRepoCredential,
  StoredGitHubAppInstallation,
} from "@/lib/github/app-types"
import { decryptSecret, encryptSecret } from "@/lib/security/secret-crypto"
import { stringValue as optionalString } from "@/lib/shared/unknown-values"
import { getWorkerSecret } from "@/lib/security/worker-secret"

export {
  createGitHubAppInstallUrl,
  createGitHubAppState,
  createGitHubAppUserLoginUrl,
  isGitHubAppConfigured,
  isGitHubAppUserAuthConfigured,
} from "@/lib/github/app-client"
export type {
  GitHubAppAccount,
  GitHubAppOrganization,
  GitHubAppRepository,
  GitHubAppStatus,
  GitHubAppUserStatus,
  GitHubDisconnectResult,
  GitHubRepoCredential,
  StoredGitHubAppInstallation,
  StoredGitHubAppUser,
} from "@/lib/github/app-types"

export const GITHUB_APP_STATE_COOKIE = "cloudcode_github_app_state"
export const GITHUB_APP_USER_NEXT_COOKIE = "cloudcode_github_app_user_next"
export const GITHUB_APP_USER_STATE_COOKIE = "cloudcode_github_app_user_state"

const GITHUB_APP_WORKER_SECRET_ERROR =
  "Set TRIGGER_WORKER_SECRET before using server-side GitHub App auth."

async function getClient() {
  return await currentUserConvexHttpClient()
}

async function fetchGitHubAppUser(token: string) {
  const data = await githubUserRequest<GitHubUserResponse>(token, "/user")
  const id =
    typeof data.id === "number" || typeof data.id === "string"
      ? String(data.id)
      : undefined
  const login = optionalString(data.login)

  if (!id || !login) {
    throw new Error("GitHub user response did not include an id and login.")
  }

  return {
    email: optionalString(data.email),
    githubUserId: id,
    login,
    name: optionalString(data.name),
  }
}

function fingerprint(token: string, updatedAt: string) {
  return createHash("sha256")
    .update(`${token}\0${updatedAt}`)
    .digest("hex")
    .slice(0, 16)
}

function normalizeGitHubAppUserStatus(value: {
  connected: boolean
  email?: string
  fingerprint?: string
  githubUserId?: string
  login?: string
  name?: string
  updatedAt?: string
}): GitHubAppUserStatus {
  if (!value.connected) return { connected: false }

  if (
    !value.fingerprint ||
    !value.githubUserId ||
    !value.login ||
    !value.updatedAt
  ) {
    throw new Error("Stored GitHub user authorization is malformed.")
  }

  return {
    connected: true,
    email: value.email,
    fingerprint: value.fingerprint,
    githubUserId: value.githubUserId,
    login: value.login,
    name: value.name,
    updatedAt: value.updatedAt,
  }
}

export type GitHubAppUserAuthSaveFields = {
  email?: string
  encryptedRefreshToken?: string
  encryptedToken: string
  expiresAt?: string
  fingerprint: string
  githubUserId: string
  login: string
  name?: string
  refreshTokenExpiresAt?: string
  updatedAt: string
}

function buildUserAuthSave(input: {
  email?: string
  expiresAt?: string
  githubUserId: string
  login: string
  name?: string
  refreshToken?: string
  refreshTokenExpiresAt?: string
  token: string
}) {
  const updatedAt = new Date().toISOString()
  const tokenFingerprint = fingerprint(input.token, updatedAt)

  return {
    auth: {
      connected: true,
      email: input.email,
      expiresAt: input.expiresAt,
      fingerprint: tokenFingerprint,
      githubUserId: input.githubUserId,
      login: input.login,
      name: input.name,
      refreshToken: input.refreshToken,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt,
      token: input.token,
      updatedAt,
    } satisfies GitHubAppUserAuth,
    fields: {
      email: input.email,
      encryptedRefreshToken: input.refreshToken
        ? encryptSecret(input.refreshToken)
        : undefined,
      encryptedToken: encryptSecret(input.token),
      expiresAt: input.expiresAt,
      fingerprint: tokenFingerprint,
      githubUserId: input.githubUserId,
      login: input.login,
      name: input.name,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt,
      updatedAt,
    } satisfies GitHubAppUserAuthSaveFields,
  }
}

async function saveGitHubAppUserAuth(input: {
  email?: string
  expiresAt?: string
  githubUserId: string
  login: string
  name?: string
  refreshToken?: string
  refreshTokenExpiresAt?: string
  token: string
}) {
  const { auth, fields } = buildUserAuthSave(input)
  const client = await getClient()
  await client.mutation(api.githubApp.saveUserAuth, {
    ...fields,
    workerSecret: getWorkerSecret(GITHUB_APP_WORKER_SECRET_ERROR),
  })

  return auth
}

export async function completeGitHubAppUserAuthorization({
  code,
  redirectUri,
}: {
  code: string
  redirectUri?: string
}) {
  const token = await exchangeGitHubAppUserCode({
    code,
    redirectUri,
  })
  const user = await fetchGitHubAppUser(token.token)

  return saveGitHubAppUserAuth({
    ...user,
    expiresAt: token.expiresAt,
    refreshToken: token.refreshToken,
    refreshTokenExpiresAt: token.refreshTokenExpiresAt,
    token: token.token,
  })
}

export async function getCurrentGitHubAppUserStatus() {
  const client = await getClient()
  return normalizeGitHubAppUserStatus(
    await client.query(api.githubApp.userStatus, {})
  )
}

function shouldRefreshUserToken(expiresAt?: string) {
  if (!expiresAt) return false
  const expiresAtMs = Date.parse(expiresAt)
  return Number.isFinite(expiresAtMs) && expiresAtMs < Date.now() + 120_000
}

export type StoredGitHubAppUserAuthRecord = {
  email?: string
  encryptedRefreshToken?: string
  encryptedToken: string
  expiresAt?: string
  fingerprint: string
  githubUserId: string
  login: string
  name?: string
  refreshTokenExpiresAt?: string
  updatedAt: string
}

// Decrypts a stored GitHub user authorization and transparently refreshes an
// expiring token, persisting the rotated token through saveRefreshed. Shared
// by the session path below and the headless worker path in app-worker.ts.
export async function resolveGitHubAppUserAuth(
  stored: StoredGitHubAppUserAuthRecord | null,
  saveRefreshed: (fields: GitHubAppUserAuthSaveFields) => Promise<void>
): Promise<GitHubAppUserAuth | null> {
  if (!stored) return null

  const token = decryptSecret(stored.encryptedToken)
  const refreshToken = stored.encryptedRefreshToken
    ? decryptSecret(stored.encryptedRefreshToken)
    : undefined

  if (!shouldRefreshUserToken(stored.expiresAt)) {
    return {
      connected: true,
      email: stored.email,
      expiresAt: stored.expiresAt,
      fingerprint: stored.fingerprint,
      githubUserId: stored.githubUserId,
      login: stored.login,
      name: stored.name,
      refreshToken,
      refreshTokenExpiresAt: stored.refreshTokenExpiresAt,
      token,
      updatedAt: stored.updatedAt,
    }
  }

  if (!refreshToken) {
    throw new Error("GitHub authorization expired. Reconnect GitHub.")
  }

  const refreshed = await refreshGitHubAppUserToken(refreshToken)
  const { auth, fields } = buildUserAuthSave({
    email: stored.email,
    expiresAt: refreshed.expiresAt,
    githubUserId: stored.githubUserId,
    login: stored.login,
    name: stored.name,
    refreshToken: refreshed.refreshToken ?? refreshToken,
    refreshTokenExpiresAt:
      refreshed.refreshTokenExpiresAt ?? stored.refreshTokenExpiresAt,
    token: refreshed.token,
  })
  await saveRefreshed(fields)

  return auth
}

async function getCurrentGitHubAppUserAuth(): Promise<GitHubAppUserAuth | null> {
  const client = await getClient()
  const stored = await client.query(api.githubApp.getUserAuth, {
    workerSecret: getWorkerSecret(GITHUB_APP_WORKER_SECRET_ERROR),
  })

  return resolveGitHubAppUserAuth(stored, async (fields) => {
    await client.mutation(api.githubApp.saveUserAuth, {
      ...fields,
      workerSecret: getWorkerSecret(GITHUB_APP_WORKER_SECRET_ERROR),
    })
  })
}

export async function verifyGitHubAppInstallation(installationId: string) {
  const data = await githubAppRequest<GitHubAppInstallationResponse>(
    `/app/installations/${encodeURIComponent(installationId)}`
  )
  const installation = normalizeInstallation(data, installationId)

  if (!installation) {
    throw new Error("GitHub App installation did not include an account.")
  }

  return installation
}

function normalizeInstallation(
  data: GitHubAppInstallationResponse,
  fallbackId?: string
): Omit<StoredGitHubAppInstallation, "updatedAt"> | null {
  const id =
    typeof data.id === "number" || typeof data.id === "string"
      ? String(data.id)
      : fallbackId
  const accountLogin = optionalString(data.account?.login)

  if (!id || !accountLogin) return null

  return {
    accountId:
      typeof data.account?.id === "number" ||
      typeof data.account?.id === "string"
        ? String(data.account.id)
        : undefined,
    accountLogin,
    accountType:
      optionalString(data.target_type) ?? optionalString(data.account?.type),
    htmlUrl: optionalString(data.html_url),
    installationId: id,
    repositorySelection: optionalString(data.repository_selection),
  }
}

export async function saveGitHubAppInstallation(
  input: Omit<StoredGitHubAppInstallation, "updatedAt">
) {
  const client = await getClient()
  return (await client.mutation(api.githubApp.saveInstallation, {
    ...input,
    updatedAt: new Date().toISOString(),
    workerSecret: getWorkerSecret(GITHUB_APP_WORKER_SECRET_ERROR),
  })) satisfies StoredGitHubAppInstallation
}

export async function getCurrentGitHubAppInstallations(): Promise<
  StoredGitHubAppInstallation[]
> {
  const client = await getClient()
  return (await client.query(
    api.githubApp.list,
    {}
  )) satisfies StoredGitHubAppInstallation[]
}

/** Resolves the GitHub App installation that can actually deliver webhooks
 * for this repository and confirms it belongs to the signed-in CloudCode
 * user. Unlike credential creation, this does not mint a short-lived token. */
export async function currentGitHubAppRepoInstallationId(repoUrl: string) {
  if (!isGitHubAppConfigured() || !isGitHubAppUserAuthConfigured()) return null
  const userAuth = await getCurrentGitHubAppUserAuth()
  if (!userAuth) return null
  const repoInstallation = await getGitHubAppRepoInstallation(repoUrl)
  if (!repoInstallation) return null
  const synced = await syncCurrentGitHubAppUserInstallations().catch(() => null)
  const installations = synced ?? (await getCurrentGitHubAppInstallations())
  return installations.some(
    (installation) =>
      installation.installationId === repoInstallation.installationId
  )
    ? repoInstallation.installationId
    : null
}

async function replaceCurrentGitHubAppInstallations(
  installations: StoredGitHubAppInstallation[]
) {
  const client = await getClient()
  return (await client.mutation(api.githubApp.replaceInstallations, {
    installations: installations.map((installation) => ({
      accountId: installation.accountId,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      htmlUrl: installation.htmlUrl,
      installationId: installation.installationId,
      repositorySelection: installation.repositorySelection,
      updatedAt: installation.updatedAt,
    })),
    workerSecret: getWorkerSecret(GITHUB_APP_WORKER_SECRET_ERROR),
  })) satisfies {
    deletedInstallations: number
    installations: StoredGitHubAppInstallation[]
  }
}

export async function syncCurrentGitHubAppUserInstallations(): Promise<
  StoredGitHubAppInstallation[]
> {
  if (!isGitHubAppConfigured() || !isGitHubAppUserAuthConfigured()) {
    return []
  }

  const userAuth = await getCurrentGitHubAppUserAuth()
  if (!userAuth) return []

  const installations = await listGitHubAppUserInstallations(userAuth.token)
  await replaceCurrentGitHubAppInstallations(installations)

  return installations
}

export async function disconnectCurrentGitHubAppUser(): Promise<GitHubDisconnectResult> {
  const userAuth = isGitHubAppUserAuthConfigured()
    ? await getCurrentGitHubAppUserAuth().catch(() => null)
    : null
  let revokedGrant = false
  let revokeError: string | undefined

  if (userAuth?.token) {
    try {
      await deleteGitHubAppUserGrant(userAuth.token)
      revokedGrant = true
    } catch (error) {
      revokeError =
        error instanceof Error
          ? error.message
          : "Unable to revoke GitHub authorization."
    }
  }

  const client = await getClient()
  const deleted = await client.mutation(api.githubApp.disconnectUser, {
    workerSecret: getWorkerSecret(GITHUB_APP_WORKER_SECRET_ERROR),
  })

  return {
    ...deleted,
    revokedGrant,
    revokeError,
  }
}

async function listGitHubAppUserInstallations(
  token: string
): Promise<StoredGitHubAppInstallation[]> {
  const installations: StoredGitHubAppInstallation[] = []

  for (let page = 1; ; page += 1) {
    const data = await githubUserRequest<GitHubUserInstallationsResponse>(
      token,
      `/user/installations?per_page=100&page=${page}`
    )
    const items = data.installations ?? []

    for (const item of items) {
      const installation = normalizeInstallation(item)
      if (installation) {
        installations.push({
          ...installation,
          updatedAt: new Date().toISOString(),
        })
      }
    }

    if (items.length < 100) break
  }

  return installations.sort((a, b) =>
    a.accountLogin.localeCompare(b.accountLogin)
  )
}

export async function listCurrentGitHubAppRepositories() {
  if (!isGitHubAppConfigured() || !isGitHubAppUserAuthConfigured()) {
    throw new Error(
      "Set the GitHub App ID, slug, private key, client ID, and client secret before listing repositories."
    )
  }

  const userAuth = await getCurrentGitHubAppUserAuth()
  if (!userAuth) {
    throw new Error("Authorize your GitHub user before listing repositories.")
  }

  const syncedInstallations =
    await syncCurrentGitHubAppUserInstallations().catch(() => null)
  const installations =
    syncedInstallations ?? (await getCurrentGitHubAppInstallations())

  if (installations.length === 0) {
    throw new Error(
      "Install the GitHub App on your account or an organization before listing repositories."
    )
  }

  const repositories: GitHubAppRepository[] = (
    await Promise.all(
      installations.map((installation) =>
        listGitHubAppInstallationRepositories(
          userAuth.token,
          installation.installationId
        ).catch(() => [])
      )
    )
  ).flat()

  return [
    ...new Map<string, GitHubAppRepository>(
      repositories.map((repo) => [repo.id, repo])
    ).values(),
  ].sort((a, b) => a.fullName.localeCompare(b.fullName))
}

export async function getCurrentGitHubAppStatus(): Promise<GitHubAppStatus> {
  const installationConfigured = isGitHubAppConfigured()
  const userAuthConfigured = isGitHubAppUserAuthConfigured()
  const user = userAuthConfigured
    ? await getCurrentGitHubAppUserStatus()
    : ({ connected: false } as const)
  const storedInstallations = installationConfigured
    ? await getCurrentGitHubAppInstallations()
    : []
  let installations: StoredGitHubAppInstallation[] = storedInstallations
  let organizations: GitHubAppOrganization[] = []
  let organizationError: string | undefined

  if (userAuthConfigured && user.connected) {
    const userAuth = await getCurrentGitHubAppUserAuth()
    if (userAuth) {
      const [nextInstallations, nextOrganizations] = await Promise.all([
        installationConfigured
          ? listGitHubAppUserInstallations(userAuth.token)
          : Promise.resolve([]),
        listGitHubAppUserOrganizations(userAuth.token).catch((error) => {
          organizationError =
            error instanceof Error
              ? error.message
              : "Unable to read GitHub organizations."
          return []
        }),
      ])
      if (installationConfigured) {
        await replaceCurrentGitHubAppInstallations(nextInstallations)
      }
      installations = nextInstallations
      organizations = nextOrganizations
    }
  }

  return {
    accounts: buildGitHubAppAccounts({
      installations,
      organizations,
      user,
    }),
    configured: installationConfigured && userAuthConfigured,
    installationConfigured,
    installations,
    organizationError,
    organizations,
    user,
    userAuthConfigured,
  }
}

async function createGitHubAppRepoCredential({
  repoUrl,
}: {
  repoUrl: string
}): Promise<GitHubRepoCredential | null> {
  if (!isGitHubAppConfigured() || !isGitHubAppUserAuthConfigured()) return null

  const userAuth = await getCurrentGitHubAppUserAuth()
  if (!userAuth) return null

  const repoInstallation = await getGitHubAppRepoInstallation(repoUrl)
  if (!repoInstallation) return null

  const syncedInstallations =
    await syncCurrentGitHubAppUserInstallations().catch(() => null)
  const installations =
    syncedInstallations ?? (await getCurrentGitHubAppInstallations())

  return await createGitHubAppRepoCredentialForInstallations({
    installations,
    repoInstallation,
    userAuth,
  })
}

export async function maybeCreateGitHubAppRepoCredential(repoUrl: string) {
  try {
    return await createGitHubAppRepoCredential({ repoUrl })
  } catch (error) {
    console.warn("Unable to create GitHub App installation token.", error)
    return null
  }
}
