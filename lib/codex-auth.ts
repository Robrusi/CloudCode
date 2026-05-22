import { createHash } from "node:crypto"

import { auth } from "@clerk/nextjs/server"
import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

const DEFAULT_PROFILE = "default"
const CONVEX_JWT_TEMPLATE = "convex"

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
  convexToken?: string
  idToken: string
  openaiApiKey?: string
  profile?: string
  refreshToken: string
}

export type SaveCodexAuthJsonForWorkerInput = {
  authJson: string
  profile?: string
  userId: Id<"users">
  workerSecret: string
}

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL

  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before using Convex storage.")
  }

  return url
}

function createClient(convexToken: string) {
  const client = new ConvexHttpClient(getConvexUrl())
  client.setAuth(convexToken)
  return client
}

export async function getConvexAuthToken() {
  const session = await auth()

  if (!session.userId) {
    throw new Error("Sign in with Clerk before using Codex OAuth storage.")
  }

  let token: string | null

  try {
    token = await session.getToken({ template: CONVEX_JWT_TEMPLATE })
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Unable to create Clerk Convex JWT: ${error.message}`
        : "Unable to create Clerk Convex JWT."
    )
  }

  if (!token) {
    throw new Error(
      'Clerk did not return a Convex JWT. Create a Clerk JWT template named "convex" with audience "convex".'
    )
  }

  return token
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

export function buildCodexAuthJson(auth: CodexChatGptAuth) {
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

export function parseCodexAuthJson(authJson: string) {
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

async function getClient(convexToken?: string) {
  return createClient(convexToken ?? (await getConvexAuthToken()))
}

export async function saveCodexOAuthTokens(input: SaveCodexOAuthTokensInput) {
  const profile = normalizeProfile(input.profile)
  const lastRefresh = new Date().toISOString()
  const auth = {
    accessToken: input.accessToken,
    accountId: getAccountIdFromIdToken(input.idToken),
    fingerprint: fingerprint(input.idToken, input.refreshToken, lastRefresh),
    idToken: input.idToken,
    lastRefresh,
    openaiApiKey: input.openaiApiKey,
    profile,
    refreshToken: input.refreshToken,
  }

  const client = await getClient(input.convexToken)
  return (await client.mutation(
    api.codexAuth.saveOAuthTokens,
    auth
  )) satisfies AuthStatus
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

export async function saveCodexAuthJsonForWorker(
  input: SaveCodexAuthJsonForWorkerInput
) {
  const parsed = parseCodexAuthJson(input.authJson)
  const profile = normalizeProfile(input.profile)
  const lastRefresh = new Date().toISOString()
  const client = new ConvexHttpClient(getConvexUrl())

  return await client.mutation(api.codexAuth.saveOAuthTokensForWorker, {
    accessToken: parsed.accessToken,
    accountId: parsed.accountId,
    fingerprint: fingerprint(parsed.idToken, parsed.refreshToken, lastRefresh),
    idToken: parsed.idToken,
    lastRefresh,
    openaiApiKey: parsed.openaiApiKey,
    profile,
    refreshToken: parsed.refreshToken,
    userId: input.userId,
    workerSecret: input.workerSecret,
  })
}

export async function getCodexAuthJson(profileInput?: string) {
  const profile = normalizeProfile(profileInput)
  const client = await getClient()
  const stored = await client.query(api.codexAuth.get, { profile })

  if (!stored) {
    throw new Error(
      `No Codex ChatGPT OAuth credentials are stored for profile "${profile}".`
    )
  }

  return buildCodexAuthJson(stored)
}

export async function getCodexAuthStatus(profileInput?: string) {
  const profile = normalizeProfile(profileInput)
  const client = await getClient()
  return (await client.query(api.codexAuth.status, {
    profile,
  })) satisfies AuthStatus
}
