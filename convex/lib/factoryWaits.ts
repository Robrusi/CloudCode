import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import {
  FACTORY_MAX_ACTIVE_WAITS_PER_THREAD,
  FACTORY_MAX_ACTIVE_WAITS_PER_USER,
  FACTORY_MAX_PENDING_EVENTS_PER_WAIT,
  FACTORY_WAIT_DEFAULT_TTL_MS,
  FACTORY_WAIT_EVENT_WINDOW_MAX,
  FACTORY_WAIT_EVENT_WINDOW_MS,
  FACTORY_WAIT_MAX_TTL_MS,
  FACTORY_WAIT_MIN_TTL_MS,
} from "@/lib/factory/limits"

/**
 * Core persistence helpers for factory waits, shared by the tool-facing
 * functions in ../factoryWaits.ts, the wake pipeline in ./factoryWake.ts,
 * and the expiry sweep. Nothing here dispatches Trigger work — callers own
 * that so a Convex transaction never depends on an external API.
 */

/** Waits still listening (or about to listen) for events. */
export const ACTIVE_WAIT_STATUSES = ["arming", "armed"] as const

export type ActiveWaitStatus = (typeof ACTIVE_WAIT_STATUSES)[number]

export function isActiveWaitStatus(
  status: Doc<"factoryWaits">["status"]
): status is ActiveWaitStatus {
  return (ACTIVE_WAIT_STATUSES as readonly string[]).includes(status)
}

export async function activeWaitsForThread(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">
) {
  const byStatus = await Promise.all(
    ACTIVE_WAIT_STATUSES.map((status) =>
      ctx.db
        .query("factoryWaits")
        .withIndex("by_thread_status", (q) =>
          q.eq("threadId", threadId).eq("status", status)
        )
        .collect()
    )
  )
  return byStatus.flat().sort((a, b) => a.createdAt - b.createdAt)
}

async function countActiveWaitsForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  const byStatus = await Promise.all(
    ACTIVE_WAIT_STATUSES.map((status) =>
      ctx.db
        .query("factoryWaits")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", userId).eq("status", status)
        )
        .collect()
    )
  )
  return byStatus.flat().length
}

/** Transactional creation guard, enforced inside the mutation that inserts
 * the wait so concurrent registrations cannot race past the caps. */
export async function requireWaitCapacity(
  ctx: MutationCtx,
  threadId: Id<"threads">,
  userId: Id<"users">
) {
  const [threadWaits, userWaits] = await Promise.all([
    activeWaitsForThread(ctx, threadId),
    countActiveWaitsForUser(ctx, userId),
  ])
  if (threadWaits.length >= FACTORY_MAX_ACTIVE_WAITS_PER_THREAD) {
    throw new Error(
      `This thread already has ${threadWaits.length} active waits (limit ${FACTORY_MAX_ACTIVE_WAITS_PER_THREAD}). Cancel one with wait_cancel before registering another.`
    )
  }
  if (userWaits >= FACTORY_MAX_ACTIVE_WAITS_PER_USER) {
    throw new Error(
      `There are already ${userWaits} active waits across your threads (limit ${FACTORY_MAX_ACTIVE_WAITS_PER_USER}).`
    )
  }
}

/** Clamps an agent-supplied TTL into the allowed window; unset means the
 * default. Every wait expires — expiry wakes the thread with a timeout event
 * instead of leaving a zombie listener. */
export function clampWaitTtlMs(ttlSeconds: number | undefined) {
  if (ttlSeconds === undefined) return FACTORY_WAIT_DEFAULT_TTL_MS
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("ttlSeconds must be a positive number of seconds.")
  }
  return Math.min(
    Math.max(Math.round(ttlSeconds * 1000), FACTORY_WAIT_MIN_TTL_MS),
    FACTORY_WAIT_MAX_TTL_MS
  )
}

/** Inserts the indexed match rows for an armed wait. */
export async function insertWaitKeys(
  ctx: MutationCtx,
  wait: Pick<Doc<"factoryWaits">, "_id" | "threadId" | "userId">,
  sourceKeys: string[]
) {
  await Promise.all(
    sourceKeys.map((sourceKey) =>
      ctx.db.insert("factoryWaitKeys", {
        sourceKey,
        threadId: wait.threadId,
        userId: wait.userId,
        waitId: wait._id,
      })
    )
  )
}

export async function deleteWaitKeys(
  ctx: MutationCtx,
  waitId: Id<"factoryWaits">
) {
  const keys = await ctx.db
    .query("factoryWaitKeys")
    .withIndex("by_wait", (q) => q.eq("waitId", waitId))
    .collect()
  await Promise.all(keys.map((key) => ctx.db.delete(key._id)))
}

/** Moves a wait to a terminal status and removes its match rows so webhook
 * lookups stop seeing it. Queued events are left in place — pending ones
 * still deliver (e.g. the timeout event of an expired wait). */
export async function closeWait(
  ctx: MutationCtx,
  wait: Doc<"factoryWaits">,
  status: "fired" | "expired" | "canceled" | "failed",
  statusReason?: string
) {
  await ctx.db.patch(wait._id, {
    status,
    ...(statusReason ? { statusReason } : {}),
    updatedAt: Date.now(),
  })
  await deleteWaitKeys(ctx, wait._id)
}

export async function pendingEventCountForWait(
  ctx: QueryCtx | MutationCtx,
  waitId: Id<"factoryWaits">
) {
  const events = await ctx.db
    .query("factoryWaitEvents")
    .withIndex("by_wait_event", (q) => q.eq("waitId", waitId))
    .collect()
  return events.filter((row) => row.status === "pending").length
}

export async function pendingWaitEventsForThread(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">,
  limit: number
) {
  return await ctx.db
    .query("factoryWaitEvents")
    .withIndex("by_thread_status_created", (q) =>
      q.eq("threadId", threadId).eq("status", "pending")
    )
    .take(limit)
}

export type RecordWaitEventResult =
  | { queued: true }
  | {
      queued: false
      reason:
        | "duplicate"
        | "event_filtered"
        | "not_armed"
        | "queue_full"
        | "rate_limited"
    }

/** Queues one matched event on an armed wait: dedupes redeliveries, applies
 * the per-wait volume caps, and inserts the pending row the next wake run
 * drains. The caller decides whether a wake can be created right away. */
export async function recordWaitEvent(
  ctx: MutationCtx,
  wait: Doc<"factoryWaits">,
  event: {
    eventKey: string
    eventName: string
    eventVars: Record<string, string>
  }
): Promise<RecordWaitEventResult> {
  if (wait.status !== "armed") return { queued: false, reason: "not_armed" }
  if (!wait.events.includes(event.eventName)) {
    return { queued: false, reason: "event_filtered" }
  }

  const existing = await ctx.db
    .query("factoryWaitEvents")
    .withIndex("by_wait_event", (q) =>
      q.eq("waitId", wait._id).eq("eventKey", event.eventKey)
    )
    .first()
  if (existing) return { queued: false, reason: "duplicate" }

  const now = Date.now()
  const windowStart = wait.eventFireWindowStart ?? 0
  const inWindow = now - windowStart < FACTORY_WAIT_EVENT_WINDOW_MS
  const fireCount = inWindow ? (wait.eventFireCount ?? 0) : 0
  if (fireCount >= FACTORY_WAIT_EVENT_WINDOW_MAX) {
    return { queued: false, reason: "rate_limited" }
  }

  const pendingCount = await pendingEventCountForWait(ctx, wait._id)
  if (pendingCount >= FACTORY_MAX_PENDING_EVENTS_PER_WAIT) {
    return { queued: false, reason: "queue_full" }
  }

  await Promise.all([
    ctx.db.patch(wait._id, {
      eventFireCount: fireCount + 1,
      eventFireWindowStart: inWindow ? windowStart : now,
      updatedAt: now,
    }),
    insertWaitEvent(ctx, wait, event),
  ])
  return { queued: true }
}

/** Inserts a queued event without the armed/rate checks. Used for the
 * synthetic timeout and arm-failure events that accompany a terminal status
 * change — those must never be dropped. */
export async function insertWaitEvent(
  ctx: MutationCtx,
  wait: Pick<Doc<"factoryWaits">, "_id" | "threadId" | "userId">,
  event: { eventKey: string; eventVars: Record<string, string> },
  status: "pending" | "reported" = "pending"
) {
  const now = Date.now()
  await ctx.db.insert("factoryWaitEvents", {
    createdAt: now,
    eventKey: event.eventKey,
    eventVars: event.eventVars,
    status,
    threadId: wait.threadId,
    updatedAt: now,
    userId: wait.userId,
    waitId: wait._id,
  })
}
