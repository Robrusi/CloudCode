import { auth } from "@clerk/nextjs/server"
import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import {
  daytonaSandboxBillingResources,
  getStartedDaytonaSandbox,
  readDaytonaSandboxInfo,
  stopDaytonaSandbox,
  type DaytonaSandboxInfo,
} from "@/lib/daytona-sandbox"
import { getConvexAuthTokenForSession } from "@/lib/codex-auth"
import type { CurrentUserSandbox } from "@/lib/sandbox-authorization"
import { requireCurrentUserSandbox } from "@/lib/sandbox-authorization"
import type {
  DaytonaBillingResources,
  DaytonaBillingState,
} from "@/lib/billing"

export class BillingRequiredError extends Error {
  constructor() {
    super("A plan with remaining usage is required.")
    this.name = "BillingRequiredError"
  }
}

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL

  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before using Convex storage.")
  }

  return url
}

async function currentUserConvexClient() {
  const session = await auth()
  if (!session.userId) throw new Error("Not authenticated.")

  const client = new ConvexHttpClient(getConvexUrl())
  client.setAuth(await getConvexAuthTokenForSession(session))
  return client
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
  const client = await currentUserConvexClient()
  const billing = await client.action(
    api.billing.checkCurrentUserInfraAccess,
    {}
  )
  if (!billing.allowed) throw new BillingRequiredError()
  return billing
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
