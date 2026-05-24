import { createHash, createSign, randomBytes } from "node:crypto"

import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import { getConvexAuthToken } from "@/lib/codex-auth"
import { parseGitHubRepoUrl } from "@/lib/github-repo"
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto"

export const GITHUB_APP_STATE_COOKIE = "cloudcode_github_app_state"
export const GITHUB_APP_USER_NEXT_COOKIE = "cloudcode_github_app_user_next"
export const GITHUB_APP_USER_STATE_COOKIE = "cloudcode_github_app_user_state"

type GitHubAccountResponse = {
  avatar_url?: unknown
  description?: unknown
  html_url?: unknown
  id?: unknown
  login?: unknown
  type?: unknown
}

type GitHubAppInstallationResponse = {
  account?: GitHubAccountResponse | null
  html_url?: unknown
  id?: unknown
  repository_selection?: unknown
  target_type?: unknown
}

type GitHubRepoInstallationResponse = {
  id?: unknown
}

type GitHubInstallationTokenResponse = {
  expires_at?: unknown
  token?: unknown
}

type GitHubAppUserTokenResponse = {
  access_token?: unknown
  error?: unknown
  error_description?: unknown
  expires_in?: unknown
  refresh_token?: unknown
  refresh_token_expires_in?: unknown
}

type GitHubUserResponse = {
  email?: unknown
  id?: unknown
  login?: unknown
  name?: unknown
}

type GitHubOrganizationResponse = GitHubAccountResponse & {
  avatar_url?: unknown
  description?: unknown
}

type GitHubOrganizationMembershipResponse = {
  organization?: GitHubOrganizationResponse | null
  state?: unknown
}

type GitHubUserInstallationsResponse = {
  installations?: GitHubAppInstallationResponse[]
}

type GitHubRepositoryResponse = {
  clone_url?: unknown
  default_branch?: unknown
  full_name?: unknown
  html_url?: unknown
  id?: unknown
  name?: unknown
  owner?: GitHubAccountResponse | null
  permissions?: {
    admin?: unknown
    maintain?: unknown
    push?: unknown
  }
  private?: unknown
}

type GitHubUserRepositoriesResponse = {
  repositories?: GitHubRepositoryResponse[]
}

type GitHubDisconnectResult = {
  deletedInstallations: number
  deletedUserAuth: boolean
  revokedGrant: boolean
  revokeError?: string
}

type NormalizedGitHubAppUserToken = {
  expiresAt?: string
  refreshToken?: string
  refreshTokenExpiresAt?: string
  token: string
}

export type StoredGitHubAppInstallation = {
  accountId?: string
  accountLogin: string
  accountType?: string
  htmlUrl?: string
  installationId: string
  repositorySelection?: string
  updatedAt: string
}

export type StoredGitHubAppUser = {
  connected: true
  email?: string
  fingerprint: string
  githubUserId: string
  login: string
  name?: string
  updatedAt: string
}

export type GitHubAppUserStatus = { connected: false } | StoredGitHubAppUser

type GitHubAppUserAuth = StoredGitHubAppUser & {
  expiresAt?: string
  refreshToken?: string
  refreshTokenExpiresAt?: string
  token: string
}

export type GitHubAppRepository = {
  cloneUrl: string
  defaultBranch?: string
  fullName: string
  htmlUrl: string
  id: string
  installationId: string
  name: string
  ownerLogin: string
  ownerType?: string
  private: boolean
}

export type GitHubAppOrganization = {
  avatarUrl?: string
  description?: string
  id: string
  login: string
}

export type GitHubAppAccount = {
  accountType: "Organization" | "User"
  avatarUrl?: string
  description?: string
  htmlUrl?: string
  id: string
  installationId?: string
  installed: boolean
  login: string
  repositorySelection?: string
}

export type GitHubRepoCredential = {
  expiresAt?: string
  gitUserEmail?: string
  gitUserName?: string
  source: "app"
  token: string
  username?: string | null
}

export type GitHubAppStatus = {
  accounts: GitHubAppAccount[]
  configured: boolean
  installationConfigured: boolean
  installations: StoredGitHubAppInstallation[]
  organizationError?: string
  organizations: GitHubAppOrganization[]
  user: GitHubAppUserStatus
  userAuthConfigured: boolean
}

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL

  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before using Convex storage.")
  }

  return url
}

function getWorkerSecret() {
  const workerSecret = process.env.TRIGGER_WORKER_SECRET

  if (!workerSecret) {
    throw new Error(
      "Set TRIGGER_WORKER_SECRET before using server-side GitHub App auth."
    )
  }

  return workerSecret
}

async function getClient() {
  const client = new ConvexHttpClient(getConvexUrl())
  client.setAuth(await getConvexAuthToken())
  return client
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export function createGitHubAppState() {
  return base64Url(randomBytes(32))
}

function getGitHubAppId() {
  const appId = process.env.GITHUB_APP_ID?.trim()
  if (!appId) throw new Error("Set GITHUB_APP_ID before using GitHub App auth.")
  return appId
}

function getGitHubAppSlug() {
  const slug = process.env.GITHUB_APP_SLUG?.trim()
  if (!slug) {
    throw new Error("Set GITHUB_APP_SLUG before using GitHub App auth.")
  }
  return slug
}

function getGitHubAppClientId() {
  const clientId = process.env.GITHUB_APP_CLIENT_ID?.trim()
  if (!clientId) {
    throw new Error("Set GITHUB_APP_CLIENT_ID before authorizing GitHub users.")
  }
  return clientId
}

function getGitHubAppClientSecret() {
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET?.trim()
  if (!clientSecret) {
    throw new Error(
      "Set GITHUB_APP_CLIENT_SECRET before authorizing GitHub users."
    )
  }
  return clientSecret
}

function getGitHubAppPrivateKey() {
  const encoded = process.env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim()
  if (encoded) return Buffer.from(encoded, "base64").toString("utf8")

  const raw = process.env.GITHUB_APP_PRIVATE_KEY?.trim()
  if (raw) return raw.replace(/\\n/g, "\n")

  throw new Error(
    "Set GITHUB_APP_PRIVATE_KEY_BASE64 before using GitHub App auth."
  )
}

export function isGitHubAppConfigured() {
  return Boolean(
    process.env.GITHUB_APP_ID?.trim() &&
    process.env.GITHUB_APP_SLUG?.trim() &&
    (process.env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim() ||
      process.env.GITHUB_APP_PRIVATE_KEY?.trim())
  )
}

export function isGitHubAppUserAuthConfigured() {
  return Boolean(
    process.env.GITHUB_APP_CLIENT_ID?.trim() &&
    process.env.GITHUB_APP_CLIENT_SECRET?.trim()
  )
}

function createGitHubAppJwt() {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const payload = base64Url(
    JSON.stringify({
      exp: now + 9 * 60,
      iat: now - 60,
      iss: getGitHubAppId(),
    })
  )
  const data = `${header}.${payload}`
  const signer = createSign("RSA-SHA256")
  signer.update(data)
  signer.end()
  const signature = signer.sign(getGitHubAppPrivateKey())

  return `${data}.${base64Url(signature)}`
}

async function parseGitHubResponse<T>(
  response: Response,
  fallbackMessage: string
) {
  const text = await response.text()
  const data = text ? (JSON.parse(text) as T) : ({} as T)

  if (!response.ok) {
    const message =
      typeof (data as { message?: unknown }).message === "string"
        ? (data as { message: string }).message
        : fallbackMessage
    throw new Error(message)
  }

  return data
}

async function githubAppRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${createGitHubAppJwt()}`,
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  })

  return parseGitHubResponse<T>(
    response,
    `GitHub App request failed with status ${response.status}.`
  )
}

async function githubUserRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {}
) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  })

  return parseGitHubResponse<T>(
    response,
    `GitHub user request failed with status ${response.status}.`
  )
}

async function deleteGitHubAppUserGrant(token: string) {
  const clientId = getGitHubAppClientId()
  const clientSecret = getGitHubAppClientSecret()
  const response = await fetch(
    `https://api.github.com/applications/${encodeURIComponent(clientId)}/grant`,
    {
      body: JSON.stringify({ access_token: token }),
      cache: "no-store",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Basic ${Buffer.from(
          `${clientId}:${clientSecret}`
        ).toString("base64")}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      method: "DELETE",
    }
  )

  if (response.status === 204) return

  await parseGitHubResponse(
    response,
    `GitHub grant revocation failed with status ${response.status}.`
  )
}

export function createGitHubAppInstallUrl({
  selectTarget,
  state,
  targetId,
}: {
  selectTarget?: boolean
  state: string
  targetId?: string
}) {
  const url = new URL(
    `https://github.com/apps/${encodeURIComponent(getGitHubAppSlug())}/installations/${
      selectTarget ? "select_target" : "new/permissions"
    }`
  )
  url.searchParams.set("state", state)
  if (targetId) {
    url.searchParams.set("target_id", targetId)
  }
  return url.toString()
}

export function createGitHubAppUserLoginUrl({ state }: { state: string }) {
  const url = new URL("https://github.com/login/oauth/authorize")
  url.searchParams.set("client_id", getGitHubAppClientId())
  url.searchParams.set("state", state)
  url.searchParams.set("prompt", "select_account")
  return url.toString()
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizedAccountType(value?: string) {
  return value === "Organization" ? "Organization" : "User"
}

function expiresAtFromNow(seconds: unknown) {
  return typeof seconds === "number"
    ? new Date(Date.now() + seconds * 1000).toISOString()
    : undefined
}

function normalizeUserTokenResponse(
  data: GitHubAppUserTokenResponse
): NormalizedGitHubAppUserToken {
  const token = optionalString(data.access_token)
  if (!token) {
    const message =
      optionalString(data.error_description) ??
      optionalString(data.error) ??
      "GitHub did not return a user access token."
    throw new Error(message)
  }

  return {
    expiresAt: expiresAtFromNow(data.expires_in),
    refreshToken: optionalString(data.refresh_token),
    refreshTokenExpiresAt: expiresAtFromNow(data.refresh_token_expires_in),
    token,
  }
}

async function requestGitHubAppUserToken(body: URLSearchParams) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    body,
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  })
  const text = await response.text()
  const data = text
    ? (JSON.parse(text) as GitHubAppUserTokenResponse)
    : ({} as GitHubAppUserTokenResponse)

  if (!response.ok) {
    const message =
      optionalString(data.error_description) ??
      optionalString(data.error) ??
      `GitHub user token request failed with status ${response.status}.`
    throw new Error(message)
  }

  return normalizeUserTokenResponse(data)
}

async function exchangeGitHubAppUserCode({ code }: { code: string }) {
  return requestGitHubAppUserToken(
    new URLSearchParams({
      client_id: getGitHubAppClientId(),
      client_secret: getGitHubAppClientSecret(),
      code,
    })
  )
}

async function refreshGitHubAppUserToken(refreshToken: string) {
  return requestGitHubAppUserToken(
    new URLSearchParams({
      client_id: getGitHubAppClientId(),
      client_secret: getGitHubAppClientSecret(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
  )
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
  const updatedAt = new Date().toISOString()
  const tokenFingerprint = fingerprint(input.token, updatedAt)
  const client = await getClient()
  await client.mutation(api.githubApp.saveUserAuth, {
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
    workerSecret: getWorkerSecret(),
  })

  return {
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
  } satisfies GitHubAppUserAuth
}

export async function completeGitHubAppUserAuthorization({
  code,
}: {
  code: string
}) {
  const token = await exchangeGitHubAppUserCode({
    code,
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

export async function getCurrentGitHubAppUserAuth(): Promise<GitHubAppUserAuth | null> {
  const client = await getClient()
  const stored = await client.query(api.githubApp.getUserAuth, {
    workerSecret: getWorkerSecret(),
  })

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

  return saveGitHubAppUserAuth({
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
    workerSecret: getWorkerSecret(),
  })) satisfies StoredGitHubAppInstallation
}

export async function getCurrentGitHubAppInstallations() {
  const client = await getClient()
  return (await client.query(
    api.githubApp.list,
    {}
  )) satisfies StoredGitHubAppInstallation[]
}

export async function syncCurrentGitHubAppUserInstallations() {
  if (!isGitHubAppConfigured() || !isGitHubAppUserAuthConfigured()) {
    return []
  }

  const userAuth = await getCurrentGitHubAppUserAuth()
  if (!userAuth) return []

  const installations = await listGitHubAppUserInstallations(userAuth.token)
  await Promise.all(
    installations.map((installation) =>
      saveGitHubAppInstallation({
        accountId: installation.accountId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        htmlUrl: installation.htmlUrl,
        installationId: installation.installationId,
        repositorySelection: installation.repositorySelection,
      })
    )
  )

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
    workerSecret: getWorkerSecret(),
  })

  return {
    ...deleted,
    revokedGrant,
    revokeError,
  }
}

async function listGitHubAppUserInstallations(token: string) {
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

function mergeGitHubAppInstallations(
  ...sources: StoredGitHubAppInstallation[][]
) {
  const installations = new Map<string, StoredGitHubAppInstallation>()

  for (const source of sources) {
    for (const installation of source) {
      installations.set(installation.installationId, {
        ...installations.get(installation.installationId),
        ...installation,
      })
    }
  }

  return [...installations.values()].sort((a, b) =>
    a.accountLogin.localeCompare(b.accountLogin)
  )
}

function normalizeOrganization(
  data: GitHubOrganizationResponse
): GitHubAppOrganization | null {
  const id =
    typeof data.id === "number" || typeof data.id === "string"
      ? String(data.id)
      : undefined
  const login = optionalString(data.login)

  if (!id || !login) return null

  return {
    avatarUrl: optionalString(data.avatar_url),
    description: optionalString(data.description),
    id,
    login,
  }
}

async function listGitHubAppUserOrganizations(token: string) {
  const organizations = new Map<string, GitHubAppOrganization>()

  try {
    for (let page = 1; ; page += 1) {
      const items = await githubUserRequest<
        GitHubOrganizationMembershipResponse[]
      >(token, `/user/memberships/orgs?state=active&per_page=100&page=${page}`)

      for (const item of items) {
        const organization = item.organization
          ? normalizeOrganization(item.organization)
          : null
        if (organization) {
          organizations.set(organization.login.toLowerCase(), organization)
        }
      }

      if (items.length < 100) break
    }

    if (organizations.size > 0) {
      return [...organizations.values()].sort((a, b) =>
        a.login.localeCompare(b.login)
      )
    }
  } catch {
    organizations.clear()
  }

  for (let page = 1; ; page += 1) {
    const items = await githubUserRequest<GitHubOrganizationResponse[]>(
      token,
      `/user/orgs?per_page=100&page=${page}`
    )

    for (const item of items) {
      const organization = normalizeOrganization(item)
      if (organization) {
        organizations.set(organization.login.toLowerCase(), organization)
      }
    }

    if (items.length < 100) break
  }

  return [...organizations.values()].sort((a, b) =>
    a.login.localeCompare(b.login)
  )
}

function buildGitHubAppAccounts({
  installations,
  organizations,
  user,
}: {
  installations: StoredGitHubAppInstallation[]
  organizations: GitHubAppOrganization[]
  user: GitHubAppUserStatus
}) {
  const accounts = new Map<string, GitHubAppAccount>()

  if (user.connected) {
    accounts.set(`user:${user.login.toLowerCase()}`, {
      accountType: "User",
      id: user.githubUserId,
      installed: false,
      login: user.login,
    })
  }

  for (const organization of organizations) {
    accounts.set(`organization:${organization.login.toLowerCase()}`, {
      accountType: "Organization",
      avatarUrl: organization.avatarUrl,
      description: organization.description,
      id: organization.id,
      installed: false,
      login: organization.login,
    })
  }

  for (const installation of installations) {
    const accountType = normalizedAccountType(installation.accountType)
    const key = `${accountType.toLowerCase()}:${installation.accountLogin.toLowerCase()}`
    const existing = accounts.get(key)

    accounts.set(key, {
      ...existing,
      accountType,
      id: installation.accountId ?? existing?.id ?? installation.accountLogin,
      htmlUrl: installation.htmlUrl ?? existing?.htmlUrl,
      installed: true,
      installationId: installation.installationId,
      login: installation.accountLogin,
      repositorySelection: installation.repositorySelection,
    })
  }

  return [...accounts.values()].sort((a, b) => {
    if (a.accountType !== b.accountType) {
      return a.accountType === "User" ? -1 : 1
    }

    return a.login.localeCompare(b.login)
  })
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
  repositoryIds?: string[]
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

async function listGitHubAppInstallationRepositories(
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

  const storedInstallations = await getCurrentGitHubAppInstallations()
  const userInstallations = await syncCurrentGitHubAppUserInstallations().catch(
    () => []
  )
  const installations = mergeGitHubAppInstallations(
    storedInstallations,
    userInstallations
  )

  if (installations.length === 0) {
    throw new Error(
      "Install the GitHub App on your account or an organization before listing repositories."
    )
  }

  const repositories = (
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
    ...new Map(repositories.map((repo) => [repo.id, repo])).values(),
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
      installations = mergeGitHubAppInstallations(
        storedInstallations,
        nextInstallations
      )
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

async function installationForRepo(repoUrl: string) {
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
    typeof data?.id === "number" || typeof data?.id === "string"
      ? String(data.id)
      : undefined

  if (!data || !repositoryId || !hasGitHubWritePermission(data.permissions)) {
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

export async function createGitHubAppRepoCredential({
  repoUrl,
}: {
  repoUrl: string
}): Promise<GitHubRepoCredential | null> {
  if (!isGitHubAppConfigured() || !isGitHubAppUserAuthConfigured()) return null

  const userAuth = await getCurrentGitHubAppUserAuth()
  if (!userAuth) return null

  const repoInstallation = await installationForRepo(repoUrl)
  if (!repoInstallation) return null

  const installations = mergeGitHubAppInstallations(
    await getCurrentGitHubAppInstallations(),
    await syncCurrentGitHubAppUserInstallations().catch(() => [])
  )
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

export async function maybeCreateGitHubAppRepoCredential(repoUrl: string) {
  try {
    return await createGitHubAppRepoCredential({ repoUrl })
  } catch (error) {
    console.warn("Unable to create GitHub App installation token.", error)
    return null
  }
}

export function fingerprintGitHubInstallationToken(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 16)
}
