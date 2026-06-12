import { auth } from "@clerk/nextjs/server"
import type { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import {
  daytonaSandboxBillingResources,
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
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await observeCurrentUserDaytonaBilling({
    resources: daytonaSandboxBillingResources(sandbox),
    sandboxId,
    state: "running",
  })
  return { access, sandbox }
}
