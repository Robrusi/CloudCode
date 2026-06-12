import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import {
  ceilMicroUsd,
  daytonaBurnRateMicroUsdPerSecond,
  type DaytonaBillingResources,
  type DaytonaBillingState,
} from "@/lib/billing/model"
import {
  enqueueUsageEventInMutation,
  type SegmentUsageResult,
  type UsageEventResult,
} from "./billingUsageEvents"

const BILLING_DAYTONA_CHECKPOINT_MS = 60_000
const DAYTONA_BILLING_RATE_VERSION = "daytona-2026-06-09"

export type LocalUsageSummary = {
  activeSandboxSegments: number
  failedMicroUsd: number
  pendingMicroUsd: number
  trackedMicroUsd: number
}

function sameResources(
  a: Pick<Doc<"billingSandboxSegments">, "cpu" | "diskGiB" | "memoryGiB">,
  b: DaytonaBillingResources
) {
  return (
    a.cpu === b.cpu && a.diskGiB === b.diskGiB && a.memoryGiB === b.memoryGiB
  )
}

function daytonaSegmentMicroUsd({
  durationMs,
  resources,
  state,
}: {
  durationMs: number
  resources: DaytonaBillingResources
  state: DaytonaBillingState
}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0
  const burnRate = daytonaBurnRateMicroUsdPerSecond({ resources, state })
  return ceilMicroUsd((durationMs / 1000) * burnRate)
}

export async function localUsageSummary(
  ctx: QueryCtx,
  userId: Id<"users">
): Promise<LocalUsageSummary> {
  const rows = await ctx.db
    .query("billingUsageEvents")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .collect()
  const activeSegments = await ctx.db
    .query("billingSandboxSegments")
    .withIndex("by_user_active", (q) =>
      q.eq("userId", userId).eq("active", true)
    )
    .collect()

  let failedMicroUsd = 0
  let pendingMicroUsd = 0
  let trackedMicroUsd = 0
  for (const row of rows) {
    if (row.status === "failed") {
      failedMicroUsd += row.amountMicroUsd
      pendingMicroUsd += row.amountMicroUsd
    } else if (row.status === "pending") {
      pendingMicroUsd += row.amountMicroUsd
    } else if (row.status === "tracked") {
      trackedMicroUsd += row.amountMicroUsd
    }
  }

  return {
    activeSandboxSegments: activeSegments.length,
    failedMicroUsd,
    pendingMicroUsd,
    trackedMicroUsd,
  }
}

export async function applySandboxObservationMutation(
  ctx: MutationCtx,
  args: {
    observedAt: number
    resources: DaytonaBillingResources
    sandboxId: string
    source: "observed" | "webhook"
    state: DaytonaBillingState
    userId: Id<"users">
  }
): Promise<SegmentUsageResult> {
  const activeSegments = await ctx.db
    .query("billingSandboxSegments")
    .withIndex("by_sandbox_active", (q) =>
      q.eq("sandboxId", args.sandboxId).eq("active", true)
    )
    .collect()
  let active: (typeof activeSegments)[number] | undefined
  for (const segment of activeSegments) {
    if (!active || segment.startedAt > active.startedAt) active = segment
  }
  const staleActiveSegments = activeSegments.filter(
    (segment) => segment._id !== active?._id
  )
  await Promise.all(
    staleActiveSegments.map((segment) =>
      ctx.db.patch(segment._id, {
        active: false,
        endedAt: args.observedAt,
        lastObservedAt: args.observedAt,
      })
    )
  )

  if (!active) {
    if (args.state === "deleted") return null
    await openSandboxSegment(ctx, args)
    return null
  }

  if (args.observedAt <= active.startedAt) {
    await ctx.db.patch(active._id, { lastObservedAt: args.observedAt })
    return null
  }

  const changed =
    active.state !== args.state ||
    !sameResources(active, args.resources) ||
    active.userId !== args.userId
  const shouldCheckpoint =
    args.observedAt - active.startedAt >= BILLING_DAYTONA_CHECKPOINT_MS
  const shouldClose = args.state === "deleted" || changed || shouldCheckpoint

  if (!shouldClose) {
    await ctx.db.patch(active._id, { lastObservedAt: args.observedAt })
    return null
  }

  const durationMs = args.observedAt - active.startedAt
  const amountMicroUsd = daytonaSegmentMicroUsd({
    durationMs,
    resources: {
      cpu: active.cpu,
      diskGiB: active.diskGiB,
      memoryGiB: active.memoryGiB,
    },
    state: active.state,
  })
  const idempotencyKey = [
    "daytona",
    args.sandboxId,
    active.startedAt,
    args.observedAt,
    active.state,
    active.rateVersion,
  ].join(":")

  let usageEvent: UsageEventResult | null = null
  if (amountMicroUsd > 0) {
    usageEvent = await enqueueUsageEventInMutation(ctx, {
      amountMicroUsd,
      idempotencyKey,
      metadata: {
        durationMs,
        resources: {
          cpu: active.cpu,
          diskGiB: active.diskGiB,
          memoryGiB: active.memoryGiB,
        },
        state: active.state,
      },
      resourceId: args.sandboxId,
      source: "daytona",
      userId: active.userId,
    })
  }

  await ctx.db.patch(active._id, {
    active: false,
    amountMicroUsd,
    endedAt: args.observedAt,
    idempotencyKey,
    lastObservedAt: args.observedAt,
    usageEventId: usageEvent?.eventId,
  })

  if (args.state !== "deleted") {
    await openSandboxSegment(ctx, args)
  }

  return usageEvent
}

async function openSandboxSegment(
  ctx: MutationCtx,
  args: {
    observedAt: number
    resources: DaytonaBillingResources
    sandboxId: string
    source: "observed" | "webhook"
    state: DaytonaBillingState
    userId: Id<"users">
  }
) {
  await ctx.db.insert("billingSandboxSegments", {
    active: true,
    cpu: args.resources.cpu,
    diskGiB: args.resources.diskGiB,
    lastObservedAt: args.observedAt,
    memoryGiB: args.resources.memoryGiB,
    rateVersion: DAYTONA_BILLING_RATE_VERSION,
    sandboxId: args.sandboxId,
    source: args.source,
    startedAt: args.observedAt,
    state: args.state,
    userId: args.userId,
  })
}
