import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { ceilMicroUsd, type BillingUsageSource } from "@/lib/billing/model"

export type UsageEventResult = {
  amountMicroUsd: number
  eventId: Id<"billingUsageEvents">
  idempotencyKey: string
  metadata?: unknown
  resourceId?: string
  source: BillingUsageSource
  status: "pending" | "tracked" | "failed"
  userId: Id<"users">
}

export type SegmentUsageResult = UsageEventResult | null

export type TrackUsageResult = {
  exhausted: boolean
  tracked: boolean
}

export function cleanUsageError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 1_000 ? `${message.slice(0, 997)}...` : message
}

export function sanitizeUsageAmount(amountMicroUsd: number) {
  if (!Number.isFinite(amountMicroUsd)) {
    throw new Error("Usage amount must be finite.")
  }
  return ceilMicroUsd(amountMicroUsd)
}

export function usageMetadata(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

export function usageEventResult(
  row: Pick<
    Doc<"billingUsageEvents">,
    | "_id"
    | "amountMicroUsd"
    | "idempotencyKey"
    | "metadata"
    | "resourceId"
    | "source"
    | "status"
    | "userId"
  >
): UsageEventResult {
  return {
    amountMicroUsd: row.amountMicroUsd,
    eventId: row._id,
    idempotencyKey: row.idempotencyKey,
    metadata: row.metadata,
    resourceId: row.resourceId,
    source: row.source,
    status: row.status,
    userId: row.userId,
  }
}

export async function enqueueUsageEventInMutation(
  ctx: MutationCtx,
  args: {
    amountMicroUsd: number
    idempotencyKey: string
    metadata?: unknown
    resourceId?: string
    source: BillingUsageSource
    userId: Id<"users">
  }
): Promise<UsageEventResult> {
  const amountMicroUsd = sanitizeUsageAmount(args.amountMicroUsd)
  const existing = await ctx.db
    .query("billingUsageEvents")
    .withIndex("by_idempotency_key", (q) =>
      q.eq("idempotencyKey", args.idempotencyKey)
    )
    .unique()
  if (existing) return usageEventResult(existing)

  const now = Date.now()
  const eventId = await ctx.db.insert("billingUsageEvents", {
    amountMicroUsd,
    createdAt: now,
    idempotencyKey: args.idempotencyKey,
    metadata: args.metadata,
    resourceId: args.resourceId,
    source: args.source,
    status: "pending",
    updatedAt: now,
    userId: args.userId,
  })

  return {
    amountMicroUsd,
    eventId,
    idempotencyKey: args.idempotencyKey,
    metadata: args.metadata,
    resourceId: args.resourceId,
    source: args.source,
    status: "pending",
    userId: args.userId,
  }
}
