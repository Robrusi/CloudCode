import { createHash } from "node:crypto"

import { auth } from "@clerk/nextjs/server"
import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  buildCodexAuthJsonFromParsed,
  getAccountIdFromIdToken,
  parseCodexAuthJson,
} from "@/lib/codex-auth-json"

const DEFAULT_PROFILE = "default"
const CONVEX_JWT_TEMPLATE = "convex"
type ClerkAuthSession = Awaited<ReturnType<typeof auth>>

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

export async function getConvexAuthTokenForSession(session: ClerkAuthSession) {
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

export async function getConvexAuthToken() {
  return await getConvexAuthTokenForSession(await auth())
}

function normalizeProfile(profile?: string) {
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

export function buildCodexAuthJson(auth: CodexChatGptAuth) {
  return buildCodexAuthJsonFromParsed({
    accessToken: auth.accessToken,
    accountId: auth.accountId,
    idToken: auth.idToken,
    lastRefresh: auth.lastRefresh,
    openaiApiKey: auth.openaiApiKey,
    refreshToken: auth.refreshToken,
  })
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

export async function getCodexAuthStatus(profileInput?: string) {
  const profile = normalizeProfile(profileInput)
  const client = await getClient()
  return (await client.query(api.codexAuth.status, {
    profile,
  })) satisfies AuthStatus
}
