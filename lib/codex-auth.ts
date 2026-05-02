import { createHash } from "node:crypto"

import { Redis } from "@upstash/redis"

const DEFAULT_PROFILE = "default"
const KEY_PREFIX = "cloudcode:codex-auth"

export type CodexChatGptAuth = {
  accessToken: string
  accountId: string | null
  authMode: "chatgpt"
  fingerprint: string
  idToken: string
  lastRefresh: string
  openaiApiKey?: string
  profile: string
  refreshToken: string
  updatedAt: string
}

type LegacyStoredAuth = {
  authJson: string
  fingerprint: string
  profile: string
  updatedAt: string
}

export type AuthStatus = {
  accountId?: string | null
  authMode?: "chatgpt"
  exists: boolean
  fingerprint?: string
  lastRefresh?: string
  profile: string
  updatedAt?: string
}

export type SaveCodexOAuthTokensInput = {
  accessToken: string
  idToken: string
  openaiApiKey?: string
  profile?: string
  refreshToken: string
}

let redis: Redis | null = null

function getRedis() {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN

    if (!url || !token) {
      throw new Error(
        "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN before using Codex OAuth storage."
      )
    }

    redis = new Redis({ token, url })
  }

  return redis
}

export function normalizeProfile(profile?: string) {
  const normalized = profile?.trim() || DEFAULT_PROFILE

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(normalized)) {
    throw new Error(
      "Profile must use only letters, numbers, underscores, or hyphens."
    )
  }

  return normalized
}

function getAuthKey(profile: string) {
  return `${KEY_PREFIX}:${profile}`
}

function fingerprint(...values: string[]) {
  return createHash("sha256")
    .update(values.join("\0"))
    .digest("hex")
    .slice(0, 16)
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split(".")

  if (!payload) {
    throw new Error("id_token must be a JWT.")
  }

  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  )

  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
    string,
    unknown
  >
}

function getAccountIdFromIdToken(idToken: string) {
  const payload = decodeJwtPayload(idToken)
  const authClaims = payload["https://api.openai.com/auth"]

  if (
    authClaims &&
    typeof authClaims === "object" &&
    !Array.isArray(authClaims)
  ) {
    const accountId = (authClaims as Record<string, unknown>).chatgpt_account_id

    if (typeof accountId === "string" && accountId.length > 0) {
      return accountId
    }
  }

  return null
}

function buildAuthJson(auth: CodexChatGptAuth) {
  return JSON.stringify(
    {
      auth_mode: auth.authMode,
      ...(auth.openaiApiKey ? { OPENAI_API_KEY: auth.openaiApiKey } : {}),
      tokens: {
        id_token: auth.idToken,
        access_token: auth.accessToken,
        refresh_token: auth.refreshToken,
        account_id: auth.accountId,
      },
      last_refresh: auth.lastRefresh,
    },
    null,
    2
  )
}

function parseCodexAuthJson(authJson: string) {
  let parsed: unknown

  try {
    parsed = JSON.parse(authJson)
  } catch {
    throw new Error("auth.json must be valid JSON.")
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("auth.json must be a JSON object.")
  }

  const record = parsed as Record<string, unknown>
  const tokens = record.tokens

  if (record.auth_mode && record.auth_mode !== "chatgpt") {
    throw new Error(
      'auth.json auth_mode must be "chatgpt" for OAuth-based Codex runs.'
    )
  }

  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    throw new Error(
      "This runner expects Codex ChatGPT OAuth tokens in auth.json."
    )
  }

  const tokenRecord = tokens as Record<string, unknown>

  if (
    typeof tokenRecord.id_token !== "string" ||
    typeof tokenRecord.access_token !== "string" ||
    typeof tokenRecord.refresh_token !== "string"
  ) {
    throw new Error(
      "auth.json tokens must include id_token, access_token, and refresh_token strings."
    )
  }

  const accountId =
    typeof tokenRecord.account_id === "string"
      ? tokenRecord.account_id
      : getAccountIdFromIdToken(tokenRecord.id_token)

  return {
    accessToken: tokenRecord.access_token,
    accountId,
    idToken: tokenRecord.id_token,
    lastRefresh:
      typeof record.last_refresh === "string"
        ? record.last_refresh
        : new Date().toISOString(),
    openaiApiKey:
      typeof record.OPENAI_API_KEY === "string"
        ? record.OPENAI_API_KEY
        : undefined,
    refreshToken: tokenRecord.refresh_token,
  }
}

function normalizeStoredAuth(profile: string, stored: unknown) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return null
  }

  const record = stored as Partial<CodexChatGptAuth & LegacyStoredAuth>

  if (record.authJson) {
    const parsed = parseCodexAuthJson(record.authJson)

    return {
      ...parsed,
      authMode: "chatgpt" as const,
      fingerprint: record.fingerprint ?? fingerprint(record.authJson),
      profile,
      updatedAt: record.updatedAt ?? new Date().toISOString(),
    } satisfies CodexChatGptAuth
  }

  if (
    record.authMode === "chatgpt" &&
    typeof record.idToken === "string" &&
    typeof record.accessToken === "string" &&
    typeof record.refreshToken === "string" &&
    typeof record.lastRefresh === "string"
  ) {
    return {
      accessToken: record.accessToken,
      accountId:
        typeof record.accountId === "string"
          ? record.accountId
          : getAccountIdFromIdToken(record.idToken),
      authMode: "chatgpt" as const,
      fingerprint:
        record.fingerprint ??
        fingerprint(record.idToken, record.refreshToken, record.lastRefresh),
      idToken: record.idToken,
      lastRefresh: record.lastRefresh,
      openaiApiKey: record.openaiApiKey,
      profile,
      refreshToken: record.refreshToken,
      updatedAt: record.updatedAt ?? new Date().toISOString(),
    } satisfies CodexChatGptAuth
  }

  return null
}

export async function saveCodexOAuthTokens(input: SaveCodexOAuthTokensInput) {
  const profile = normalizeProfile(input.profile)
  const lastRefresh = new Date().toISOString()
  const auth: CodexChatGptAuth = {
    accessToken: input.accessToken,
    accountId: getAccountIdFromIdToken(input.idToken),
    authMode: "chatgpt",
    fingerprint: fingerprint(input.idToken, input.refreshToken, lastRefresh),
    idToken: input.idToken,
    lastRefresh,
    openaiApiKey: input.openaiApiKey,
    profile,
    refreshToken: input.refreshToken,
    updatedAt: lastRefresh,
  }

  await getRedis().set(getAuthKey(profile), auth)

  return {
    accountId: auth.accountId,
    authMode: auth.authMode,
    exists: true,
    fingerprint: auth.fingerprint,
    lastRefresh: auth.lastRefresh,
    profile,
    updatedAt: auth.updatedAt,
  } satisfies AuthStatus
}

export async function saveCodexAuthJson(
  profileInput: string | undefined,
  authJson: string
) {
  const parsed = parseCodexAuthJson(authJson)

  return saveCodexOAuthTokens({
    accessToken: parsed.accessToken,
    idToken: parsed.idToken,
    openaiApiKey: parsed.openaiApiKey,
    profile: profileInput,
    refreshToken: parsed.refreshToken,
  })
}

export async function getCodexAuthJson(profileInput?: string) {
  const profile = normalizeProfile(profileInput)
  const stored = normalizeStoredAuth(
    profile,
    await getRedis().get(getAuthKey(profile))
  )

  if (!stored) {
    throw new Error(
      `No Codex ChatGPT OAuth credentials are stored for profile "${profile}".`
    )
  }

  return buildAuthJson(stored)
}

export async function getCodexAuthStatus(profileInput?: string) {
  const profile = normalizeProfile(profileInput)
  const stored = normalizeStoredAuth(
    profile,
    await getRedis().get(getAuthKey(profile))
  )

  if (!stored) {
    return { exists: false, profile } satisfies AuthStatus
  }

  return {
    accountId: stored.accountId,
    authMode: stored.authMode,
    exists: true,
    fingerprint: stored.fingerprint,
    lastRefresh: stored.lastRefresh,
    profile,
    updatedAt: stored.updatedAt,
  } satisfies AuthStatus
}
