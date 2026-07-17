import { createSign, randomBytes } from "node:crypto"

import { stringValue as optionalString } from "@/lib/shared/unknown-values"

export type GitHubAccountResponse = {
  avatar_url?: unknown
  description?: unknown
  html_url?: unknown
  id?: unknown
  login?: unknown
  type?: unknown
}

export type GitHubAppInstallationResponse = {
  account?: GitHubAccountResponse | null
  html_url?: unknown
  id?: unknown
  repository_selection?: unknown
  target_type?: unknown
}

export type GitHubRepoInstallationResponse = {
  id?: unknown
  permissions?: Record<string, unknown> | null
}

export type GitHubInstallationTokenResponse = {
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

export type GitHubUserResponse = {
  email?: unknown
  id?: unknown
  login?: unknown
  name?: unknown
}

export type GitHubOrganizationResponse = GitHubAccountResponse & {
  avatar_url?: unknown
  description?: unknown
}

export type GitHubOrganizationMembershipResponse = {
  organization?: GitHubOrganizationResponse | null
  state?: unknown
}

export type GitHubUserInstallationsResponse = {
  installations?: GitHubAppInstallationResponse[]
}

export type GitHubRepositoryResponse = {
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

export type GitHubUserRepositoriesResponse = {
  repositories?: GitHubRepositoryResponse[]
}

type NormalizedGitHubAppUserToken = {
  expiresAt?: string
  refreshToken?: string
  refreshTokenExpiresAt?: string
  token: string
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

export async function githubAppRequest<T>(
  path: string,
  init: RequestInit = {}
) {
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

export async function githubUserRequest<T>(
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

export async function deleteGitHubAppUserGrant(token: string) {
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

export function createGitHubAppUserLoginUrl({
  redirectUri,
  state,
}: {
  redirectUri?: string
  state: string
}) {
  const url = new URL("https://github.com/login/oauth/authorize")
  url.searchParams.set("client_id", getGitHubAppClientId())
  if (redirectUri) {
    url.searchParams.set("redirect_uri", redirectUri)
  }
  url.searchParams.set("state", state)
  url.searchParams.set("prompt", "select_account")
  return url.toString()
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

export async function exchangeGitHubAppUserCode({
  code,
  redirectUri,
}: {
  code: string
  redirectUri?: string
}) {
  const body = new URLSearchParams({
    client_id: getGitHubAppClientId(),
    client_secret: getGitHubAppClientSecret(),
    code,
  })
  if (redirectUri) {
    body.set("redirect_uri", redirectUri)
  }

  return requestGitHubAppUserToken(body)
}

export async function refreshGitHubAppUserToken(refreshToken: string) {
  return requestGitHubAppUserToken(
    new URLSearchParams({
      client_id: getGitHubAppClientId(),
      client_secret: getGitHubAppClientSecret(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
  )
}
