import { createHash } from "node:crypto"

import { auth } from "@clerk/nextjs/server"
import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  buildCodexAuthJsonFromParsed,
  getCodexProfileFromIdToken,
  parseCodexAuthJson,
} from "@/lib/codex/auth-json"
import {
  normalizeCodexProfile,
  type CodexAuthOverview,
} from "@/lib/codex/auth-types"
import { requireConvexUrl } from "@/lib/convex/env"

const CONVEX_JWT_TEMPLATE = "convex"
type CodexClerkAuthSession = Awaited<ReturnType<typeof auth>>

export type CodexChatGptAuth = {
  accessToken: string
  accountEmail?: string
  accountId: string | null
  accountName?: string
  authMode: "chatgpt"
  fingerprint: string
  idToken: string
  lastRefresh: string
  openaiApiKey?: string
  profile: string
  refreshToken: string
  updatedAt: string
}

export type AuthStatus = CodexAuthOverview

export type SaveCodexOAuthTokensInput = {
  accessToken: string
  activate?: boolean
  convexToken?: string
  idToken: string
  openaiApiKey?: string
  profile?: string
  refreshToken: string
  useAccountProfile?: boolean
}

export type SaveCodexAuthJsonForWorkerInput = {
  authJson: string
  expectedFingerprint?: string
  profile?: string
  userId: Id<"users">
  workerSecret: string
}

function createClient(convexToken: string) {
  const client = new ConvexHttpClient(requireConvexUrl())
  client.setAuth(convexToken)
  return client
}

export async function getConvexAuthTokenForSession(
  session: CodexClerkAuthSession
) {
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

function fingerprint(...values: string[]) {
  return createHash("sha256")
    .update(values.join("\0"))
    .digest("hex")
    .slice(0, 16)
}

function profileFromAccount(accountId: string | null, idToken: string) {
  const safePrefix =
    (accountId ? `chatgpt_${accountId}` : "chatgpt")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "chatgpt"
  const suffix = fingerprint(accountId ?? idToken).slice(0, 8)

  return normalizeCodexProfile(`${safePrefix}_${suffix}`)
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
  const idTokenProfile = getCodexProfileFromIdToken(input.idToken)
  const profile = normalizeCodexProfile(
    input.profile ??
      (input.useAccountProfile
        ? profileFromAccount(idTokenProfile.accountId, input.idToken)
        : undefined)
  )
  const lastRefresh = new Date().toISOString()
  const auth = {
    accessToken: input.accessToken,
    accountEmail: idTokenProfile.accountEmail,
    accountId: idTokenProfile.accountId,
    accountName: idTokenProfile.accountName,
    activate: input.activate,
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
  )) satisfies CodexAuthOverview
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
    // Without an explicit profile, derive one from the account so importing a
    // different account adds it instead of overwriting the "default" profile.
    useAccountProfile: profileInput === undefined,
  })
}

export async function saveCodexAuthJsonForWorker(
  input: SaveCodexAuthJsonForWorkerInput
) {
  const parsed = parseCodexAuthJson(input.authJson)
  const profile = normalizeCodexProfile(input.profile)
  const lastRefresh = new Date().toISOString()
  const client = new ConvexHttpClient(requireConvexUrl())

  return await client.mutation(api.codexAuth.saveOAuthTokensForWorker, {
    accessToken: parsed.accessToken,
    accountId: parsed.accountId,
    expectedFingerprint: input.expectedFingerprint,
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

export async function invalidateCodexAuthForWorker(input: {
  invalidReason: string
  profile: string
  userId: Id<"users">
  workerSecret: string
}) {
  const client = new ConvexHttpClient(requireConvexUrl())

  return await client.mutation(api.codexAuth.invalidateOAuthTokensForWorker, {
    invalidReason: input.invalidReason,
    profile: input.profile,
    userId: input.userId,
    workerSecret: input.workerSecret,
  })
}

export async function getCodexAuthStatus(profileInput?: string) {
  const profile = profileInput ? normalizeCodexProfile(profileInput) : undefined
  const client = await getClient()
  return (await client.query(api.codexAuth.overview, {
    profile,
  })) satisfies CodexAuthOverview
}

export async function setActiveCodexAuthProfile(profileInput: string) {
  const profile = normalizeCodexProfile(profileInput)
  const client = await getClient()

  return (await client.mutation(api.codexAuth.setActiveProfile, {
    profile,
  })) satisfies CodexAuthOverview
}

export async function renameCodexAuthProfile(
  profileInput: string,
  displayName: string
) {
  const profile = normalizeCodexProfile(profileInput)
  const client = await getClient()

  return (await client.mutation(api.codexAuth.renameProfile, {
    displayName,
    profile,
  })) satisfies CodexAuthOverview
}

export async function disconnectCodexAuthProfile(profileInput: string) {
  const profile = normalizeCodexProfile(profileInput)
  const client = await getClient()

  return (await client.mutation(api.codexAuth.disconnectProfile, {
    profile,
  })) satisfies CodexAuthOverview
}
