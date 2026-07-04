import { auth } from "@clerk/nextjs/server"
import type { ConvexHttpClient } from "convex/browser"

import type { Sandbox } from "@daytona/sdk"

import { api } from "@/convex/_generated/api"
import {
  daytonaSandboxBillingResources,
  DaytonaSandboxNotRunningError,
  getDaytonaSandbox,
  getRunningDaytonaSandbox,
  getStartedDaytonaSandbox,
  readDaytonaSandboxInfo,
  stopDaytonaSandbox,
  type DaytonaSandboxInfo,
} from "@/lib/daytona/sandbox"
import { convexHttpClientForSession } from "@/lib/convex/http"
import type { CurrentUserSandbox } from "@/lib/sandbox/authorization"
import { requireCurrentUserSandbox } from "@/lib/sandbox/authorization"
import type {
  DaytonaBillingResources,
  DaytonaBillingState,
} from "@/lib/billing/model"

export class BillingRequiredError extends Error {
  constructor() {
    super("A plan with remaining usage is required.")
    this.name = "BillingRequiredError"
  }
}

export class SandboxNotRunningError extends Error {
  constructor() {
    super("Sandbox is not running.")
    this.name = "SandboxNotRunningError"
  }
}

const INFRA_ACCESS_CACHE_TTL_MS = 15_000
const INFRA_ACCESS_CACHE_MAX_ENTRIES = 500

async function currentUserConvexClient() {
  const session = await auth()
  if (!session.userId) throw new Error("Not authenticated.")

  return await convexHttpClientForSession(session)
}

async function checkCurrentUserInfraAccess(client: ConvexHttpClient) {
  const billing = await client.action(
    api.billing.checkCurrentUserInfraAccess,
    {}
  )
  if (!billing.allowed) throw new BillingRequiredError()
  return billing
}

type InfraAccess = Awaited<ReturnType<typeof checkCurrentUserInfraAccess>>

type InfraAccessCacheEntry = {
  expiresAt: number
  promise: Promise<InfraAccess>
}

const infraAccessCache = new Map<string, InfraAccessCacheEntry>()

function pruneInfraAccessCache(now: number) {
  for (const [key, entry] of infraAccessCache) {
    if (entry.expiresAt <= now) infraAccessCache.delete(key)
  }

  while (infraAccessCache.size > INFRA_ACCESS_CACHE_MAX_ENTRIES) {
    const oldest = infraAccessCache.keys().next()
    if (oldest.done) break
    infraAccessCache.delete(oldest.value)
  }
}

export async function observeCurrentUserDaytonaBilling({
  observedAt = Date.now(),
  resources,
  sandboxId,
  state,
}: {
  observedAt?: number
  resources: DaytonaBillingResources
  sandboxId: string
  state: DaytonaBillingState
}) {
  const client = await currentUserConvexClient()
  return await client.action(api.billing.observeCurrentUserDaytonaSandbox, {
    cpu: resources.cpu,
    diskGiB: resources.diskGiB,
    memoryGiB: resources.memoryGiB,
    observedAt,
    sandboxId,
    source: "observed",
    state,
  })
}

export async function requireCurrentUserInfraAccess() {
  const session = await auth()
  if (!session.userId) throw new Error("Not authenticated.")

  const now = Date.now()
  const cached = infraAccessCache.get(session.userId)
  if (cached && cached.expiresAt > now) return await cached.promise
  if (cached) infraAccessCache.delete(session.userId)

  const client = await convexHttpClientForSession(session)
  const promise = checkCurrentUserInfraAccess(client)
  infraAccessCache.set(session.userId, {
    expiresAt: now + INFRA_ACCESS_CACHE_TTL_MS,
    promise,
  })
  pruneInfraAccessCache(now)

  promise.catch(() => {
    if (infraAccessCache.get(session.userId)?.promise === promise) {
      infraAccessCache.delete(session.userId)
    }
  })

  return await promise
}

export async function observeCurrentUserDaytonaBillingInfo(
  info: DaytonaSandboxInfo
) {
  return await observeCurrentUserDaytonaBilling({
    observedAt: Date.now(),
    resources: {
      cpu: info.cpu,
      diskGiB: info.diskGiB,
      memoryGiB: info.memoryGiB,
    },
    sandboxId: info.sandboxId,
    state: info.billingState,
  })
}

export async function pauseCurrentUserSandboxForBilling(sandboxId: string) {
  try {
    const current = await readDaytonaSandboxInfo(sandboxId)
    if (current.billingState !== "running") return { paused: false }

    const stopped = await stopDaytonaSandbox(sandboxId)
    await observeCurrentUserDaytonaBillingInfo(stopped)
    return { paused: true }
  } catch (error) {
    console.warn("Unable to pause sandbox after billing denial.", error)
    return { paused: false }
  }
}

// Read-heavy routes (file browser, diff panel) hit these helpers once per
// file. The Daytona lookup result cannot meaningfully change within a few
// seconds, so a short shared cache turns a burst of reads into one upstream
// lookup. Authorization and infra access stay per-request (their own caches).
const SANDBOX_LOOKUP_CACHE_TTL_MS = 10_000
const BILLING_OBSERVATION_THROTTLE_MS = 30_000

type SandboxLookupCacheEntry = {
  expiresAt: number
  promise: Promise<Sandbox>
}

const startedSandboxCache = new Map<string, SandboxLookupCacheEntry>()
const runningSandboxCache = new Map<string, SandboxLookupCacheEntry>()
const lastBillingObservationAt = new Map<string, number>()

function cachedSandboxLookup(
  cache: Map<string, SandboxLookupCacheEntry>,
  sandboxId: string,
  lookup: () => Promise<Sandbox>
) {
  const now = Date.now()
  const cached = cache.get(sandboxId)
  if (cached && cached.expiresAt > now) return cached.promise
  if (cached) cache.delete(sandboxId)

  const promise = lookup()
  cache.set(sandboxId, {
    expiresAt: now + SANDBOX_LOOKUP_CACHE_TTL_MS,
    promise,
  })
  promise.catch(() => {
    if (cache.get(sandboxId)?.promise === promise) cache.delete(sandboxId)
  })
  return promise
}

/**
 * Records a usage sample without blocking or failing the caller: billing
 * segments are reconciled by the worker cron every minute, so per-request
 * observations are throttled redundancy, not the source of truth.
 */
function observeCurrentUserDaytonaBillingThrottled(sandbox: Sandbox) {
  const now = Date.now()
  const last = lastBillingObservationAt.get(sandbox.id) ?? 0
  if (now - last < BILLING_OBSERVATION_THROTTLE_MS) return

  lastBillingObservationAt.set(sandbox.id, now)
  void observeCurrentUserDaytonaBilling({
    resources: daytonaSandboxBillingResources(sandbox),
    sandboxId: sandbox.id,
    state: "running",
  }).catch((error) => {
    lastBillingObservationAt.delete(sandbox.id)
    console.warn("Unable to observe sandbox billing.", error)
  })
}

export async function getStartedCurrentUserDaytonaSandbox(
  sandboxId: string
): Promise<{
  access: CurrentUserSandbox
  sandbox: Awaited<ReturnType<typeof getStartedDaytonaSandbox>>
}> {
  const access = await requireCurrentUserSandbox(sandboxId)
  try {
    await requireCurrentUserInfraAccess()
  } catch (error) {
    if (error instanceof BillingRequiredError) {
      await pauseCurrentUserSandboxForBilling(sandboxId)
    }
    throw error
  }
  const sandbox = await cachedSandboxLookup(
    startedSandboxCache,
    sandboxId,
    () => getStartedDaytonaSandbox(sandboxId)
  )
  observeCurrentUserDaytonaBillingThrottled(sandbox)
  return { access, sandbox }
}

export async function getRunningCurrentUserDaytonaSandbox(
  sandboxId: string
): Promise<{
  access: CurrentUserSandbox
  sandbox: Awaited<ReturnType<typeof getDaytonaSandbox>>
}> {
  const access = await requireCurrentUserSandbox(sandboxId)
  const sandbox = await cachedSandboxLookup(
    runningSandboxCache,
    sandboxId,
    async () => {
      const running = await getRunningDaytonaSandbox(sandboxId).catch(
        (error) => {
          if (error instanceof DaytonaSandboxNotRunningError) {
            throw new SandboxNotRunningError()
          }
          throw error
        }
      )
      if (running.state !== "started") throw new SandboxNotRunningError()
      return running
    }
  )

  try {
    await requireCurrentUserInfraAccess()
  } catch (error) {
    if (error instanceof BillingRequiredError) {
      await pauseCurrentUserSandboxForBilling(sandboxId)
    }
    throw error
  }

  observeCurrentUserDaytonaBillingThrottled(sandbox)
  return { access, sandbox }
}
