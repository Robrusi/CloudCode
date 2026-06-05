import { auth } from "@clerk/nextjs/server"
import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import { getConvexAuthTokenForSession } from "@/lib/codex-auth"

export class SandboxAuthorizationError extends Error {
  constructor() {
    super("Sandbox not found.")
    this.name = "SandboxAuthorizationError"
  }
}

export type CurrentUserSandbox = {
  repoUrl: string
}

const SANDBOX_ACCESS_CACHE_TTL_MS = 15_000
const SANDBOX_ACCESS_CACHE_MAX_ENTRIES = 500

type SandboxAccessCacheEntry = {
  expiresAt: number
  sandbox: CurrentUserSandbox
}

const sandboxAccessCache = new Map<string, SandboxAccessCacheEntry>()

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL

  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before using Convex storage.")
  }

  return url
}

function sandboxAccessCacheKey(userId: string, sandboxId: string) {
  return `${userId}:${sandboxId}`
}

function pruneSandboxAccessCache(now: number) {
  for (const [key, entry] of sandboxAccessCache) {
    if (entry.expiresAt <= now) sandboxAccessCache.delete(key)
  }

  while (sandboxAccessCache.size > SANDBOX_ACCESS_CACHE_MAX_ENTRIES) {
    const oldest = sandboxAccessCache.keys().next()
    if (oldest.done) break
    sandboxAccessCache.delete(oldest.value)
  }
}

export async function requireCurrentUserSandbox(
  sandboxId: string
): Promise<CurrentUserSandbox> {
  const session = await auth()
  if (!session.userId) throw new SandboxAuthorizationError()

  const now = Date.now()
  const cacheKey = sandboxAccessCacheKey(session.userId, sandboxId)
  const cached = sandboxAccessCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.sandbox
  if (cached) sandboxAccessCache.delete(cacheKey)

  const client = new ConvexHttpClient(getConvexUrl())
  client.setAuth(await getConvexAuthTokenForSession(session))

  const sandbox = await client.query(api.codexRuns.sandboxAccess, {
    sandboxId,
  })

  if (!sandbox) throw new SandboxAuthorizationError()

  sandboxAccessCache.set(cacheKey, {
    expiresAt: now + SANDBOX_ACCESS_CACHE_TTL_MS,
    sandbox,
  })
  pruneSandboxAccessCache(now)

  return sandbox
}
