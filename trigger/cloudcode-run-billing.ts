import { usage } from "@trigger.dev/sdk"

import type { Id } from "@/convex/_generated/dataModel"
import {
  daytonaBillingState,
  microUsdFromTriggerCents,
  type DaytonaBillingState,
} from "@/lib/billing/model"
import {
  daytonaSandboxBillingResources,
  getDaytonaSandbox,
  stopDaytonaSandbox,
} from "@/lib/daytona/sandbox"
import {
  observeWorkerDaytonaSandbox,
  recordWorkerBillingUsage,
  type WorkerConvexClient,
} from "@/lib/codex/run-worker"

const BILLING_TRIGGER_CHECKPOINT_MS = 30_000

export type ActiveBillingSandboxSegment = {
  cpu: number
  diskGiB: number
  memoryGiB: number
  sandboxId: string
  userId: Id<"users">
}

export function createBillingAbortController(signal: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  signal.addEventListener("abort", abort, { once: true })
  return {
    abort: (reason?: unknown) => controller.abort(reason),
    cleanup: () => signal.removeEventListener("abort", abort),
    signal: controller.signal,
  }
}

export function createTriggerUsageMeter({
  client,
  failBilling,
  onExhausted,
  triggerRunId,
  userId,
}: {
  client: WorkerConvexClient
  failBilling: (error: unknown) => void
  onExhausted: () => Promise<void>
  triggerRunId: string
  userId: Id<"users">
}) {
  let checkpoint = 0
  let stopped = false
  let trackedMicroUsd = 0
  let flushPromise: Promise<void> | undefined

  const flush = (reason: string) => {
    if (flushPromise) return flushPromise

    flushPromise = (async () => {
      const current = usage.getCurrent()
      const totalMicroUsd = microUsdFromTriggerCents(current.totalCostInCents)
      const amountMicroUsd = totalMicroUsd - trackedMicroUsd
      if (amountMicroUsd <= 0) return

      const nextCheckpoint = checkpoint + 1
      const result = await recordWorkerBillingUsage(client, {
        amountMicroUsd,
        idempotencyKey: `trigger:${triggerRunId}:${nextCheckpoint}`,
        metadata: {
          baseCostInCents: current.baseCostInCents,
          computeCostInCents: current.compute.total.costInCents,
          durationMs: current.compute.total.durationMs,
          reason,
          totalCostInCents: current.totalCostInCents,
        },
        resourceId: triggerRunId,
        source: "trigger",
        userId,
      })

      if (result.tracked) {
        checkpoint = nextCheckpoint
        trackedMicroUsd = totalMicroUsd
      }
      if (result.exhausted) await onExhausted()
    })()
      .catch((error) => {
        failBilling(error)
        throw error
      })
      .finally(() => {
        flushPromise = undefined
      })

    return flushPromise
  }

  const timer = setInterval(() => {
    if (stopped) return
    void flush("periodic").catch(() => undefined)
  }, BILLING_TRIGGER_CHECKPOINT_MS)
  timer.unref?.()

  return {
    flush,
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
  }
}

export async function observeSandboxBilling({
  client,
  sandboxId,
  source,
  userId,
}: {
  client: WorkerConvexClient
  sandboxId: string
  source: "observed" | "webhook"
  userId: Id<"users">
}) {
  const sandbox = await getDaytonaSandbox(sandboxId)
  await sandbox.refreshData().catch(() => undefined)
  return await observeWorkerDaytonaSandbox(client, {
    observedAt: Date.now(),
    resources: daytonaSandboxBillingResources(sandbox),
    sandboxId,
    source,
    state: daytonaBillingState(sandbox.state),
    userId,
  })
}

export async function observeActiveBillingSandboxSegment({
  client,
  segment,
}: {
  client: WorkerConvexClient
  segment: ActiveBillingSandboxSegment
}) {
  let state: DaytonaBillingState = "deleted"
  let resources = {
    cpu: segment.cpu,
    diskGiB: segment.diskGiB,
    memoryGiB: segment.memoryGiB,
  }

  try {
    const sandbox = await getDaytonaSandbox(segment.sandboxId)
    await sandbox.refreshData().catch(() => undefined)
    state = daytonaBillingState(sandbox.state)
    resources = daytonaSandboxBillingResources(sandbox)
  } catch {
    state = "deleted"
  }

  return await observeWorkerDaytonaSandbox(client, {
    observedAt: Date.now(),
    resources,
    sandboxId: segment.sandboxId,
    source: "observed",
    state,
    userId: segment.userId,
  })
}

export async function pauseSandboxForBilling({
  client,
  sandboxId,
  userId,
}: {
  client: WorkerConvexClient
  sandboxId: string
  userId: Id<"users">
}) {
  const sandbox = await getDaytonaSandbox(sandboxId)
  await sandbox.refreshData().catch(() => undefined)
  if (daytonaBillingState(sandbox.state) !== "running") {
    return { paused: false }
  }

  const info = await stopDaytonaSandbox(sandboxId)
  await observeWorkerDaytonaSandbox(client, {
    observedAt: Date.now(),
    resources: {
      cpu: info.cpu,
      diskGiB: info.diskGiB,
      memoryGiB: info.memoryGiB,
    },
    sandboxId,
    source: "observed",
    state: info.billingState,
    userId,
  })
  return { paused: true }
}
