import { v } from "convex/values"

import { api, internal } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server"
import { getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"
import {
  BILLING_FREE_PLAN_ID,
  type BillingPlanId,
  type UsageHoursInfo,
} from "@/lib/billing/model"
import {
  applySandboxObservationMutation,
  localUsageSummary,
} from "./billingSandboxSegments"
import {
  activeBasePlanSubscription,
  resolveActivePlan,
  scheduledBasePlanSubscription,
  type ActivePlanInfo,
} from "./billingPlan"
import {
  autumnCustomerId,
  autumnCustomerParams,
  checkRemainingInfraAccess,
  ensureAutumnCustomer,
  livePlanInfoWithUsage,
  recordUsageEvent,
  trackUsageEvent,
  type BillingUser,
} from "./billingAutumn"
import {
  enqueueUsageEventInMutation,
  usageEventResult,
  type SegmentUsageResult,
  type TrackUsageResult,
  type UsageEventResult,
} from "./billingUsageEvents"

const billingPlanId = v.union(
  v.literal("free"),
  v.literal("hobby"),
  v.literal("plus")
)
const billingUsageSource = v.union(
  v.literal("trigger"),
  v.literal("daytona"),
  v.literal("reconciliation")
)
const daytonaBillingState = v.union(
  v.literal("running"),
  v.literal("stopped"),
  v.literal("archived"),
  v.literal("deleted"),
  v.literal("unknown")
)
const sandboxSegmentSource = v.union(
  v.literal("observed"),
  v.literal("webhook")
)

type EnsureFreePlanResult = {
  customerId: string
  planId: BillingPlanId
  synced: boolean
}

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    const [customer, summary] = await Promise.all([
      ctx.db
        .query("billingCustomers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique(),
      localUsageSummary(ctx, user._id),
    ])

    return {
      customer,
      summary,
    }
  },
})

export const activeDaytonaSegmentsForWorker = query({
  args: {
    limit: v.optional(v.number()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    return await ctx.db
      .query("billingSandboxSegments")
      .withIndex("by_active", (q) => q.eq("active", true))
      .take(Math.max(1, Math.min(200, Math.round(args.limit ?? 100))))
  },
})

export const syncCurrentUserCustomer = action({
  args: {},
  handler: async (ctx) => {
    const user = (await ctx.runQuery(
      api.users.viewer,
      {}
    )) as BillingUser | null
    if (!user) throw new Error("Not authenticated.")
    await ensureAutumnCustomer(ctx, user)
    return { customerId: autumnCustomerId(user._id) }
  },
})

export const ensureCurrentUserFreePlan = action({
  args: {},
  handler: async (ctx): Promise<EnsureFreePlanResult> => {
    const user = (await ctx.runQuery(
      api.users.viewer,
      {}
    )) as BillingUser | null
    if (!user) throw new Error("Not authenticated.")

    const existing = (await ctx.runQuery(
      internal.billing.customerRecordForUser,
      {
        userId: user._id,
      }
    )) as Doc<"billingCustomers"> | null
    if (existing?.planId) {
      return {
        customerId: existing.autumnCustomerId,
        planId: existing.planId,
        synced: false,
      }
    }

    const { customer, customerId } = await ensureAutumnCustomer(ctx, user)
    const plan = resolveActivePlan(customer)
    return {
      customerId,
      planId: plan.planId ?? BILLING_FREE_PLAN_ID,
      synced: true,
    }
  },
})

export const checkCurrentUserInfraAccess = action({
  args: {
    requiredMicroUsd: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ allowed: boolean; requiredBalance: number }> => {
    const user = (await ctx.runQuery(
      api.users.viewer,
      {}
    )) as BillingUser | null
    if (!user) throw new Error("Not authenticated.")

    const { autumn, customerId } = await ensureAutumnCustomer(ctx, user)
    const check = await checkRemainingInfraAccess(ctx, {
      autumn,
      customerId,
      withPreview: true,
      requiredMicroUsd: args.requiredMicroUsd,
      userId: user._id,
    })

    return {
      allowed: check.allowed,
      requiredBalance: check.requiredBalance,
    }
  },
})

export const attachCurrentUserPlan = action({
  args: {
    planId: billingPlanId,
    returnUrl: v.optional(v.string()),
    successUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = (await ctx.runQuery(
      api.users.viewer,
      {}
    )) as BillingUser | null
    if (!user) throw new Error("Not authenticated.")

    const { autumn, customerId } = await ensureAutumnCustomer(ctx, user)
    const response = await autumn.billing.attach({
      customerId,
      planId: args.planId,
      redirectMode: args.planId === BILLING_FREE_PLAN_ID ? "never" : "always",
      successUrl: args.successUrl,
    })
    const customer = await autumn.customers.getOrCreate(
      autumnCustomerParams(user)
    )
    const plan = resolveActivePlan(customer)

    await ctx.runMutation(internal.billing.upsertCustomerRecord, {
      autumnCustomerId: customerId,
      email: user.email,
      name: user.name,
      ...(response.paymentUrl ? {} : { planId: plan.planId ?? args.planId }),
      status: response.paymentUrl
        ? "checkout_required"
        : (plan.status ?? "active"),
      userId: user._id,
    })

    return {
      checkoutUrl: response.paymentUrl,
      customerId,
      planId: args.planId,
      returnUrl: args.returnUrl,
      scheduledPlanId: plan.scheduledPlanId,
    }
  },
})

export const refreshCurrentUserPlan = action({
  args: {},
  handler: async (
    ctx
  ): Promise<ActivePlanInfo & { usage: UsageHoursInfo | null }> => {
    const user = (await ctx.runQuery(
      api.users.viewer,
      {}
    )) as BillingUser | null
    if (!user) throw new Error("Not authenticated.")

    const { customer } = await ensureAutumnCustomer(ctx, user)
    return await livePlanInfoWithUsage(ctx, {
      customer,
      userId: user._id,
    })
  },
})

export const cancelCurrentUserScheduledPlan = action({
  args: {},
  handler: async (
    ctx
  ): Promise<ActivePlanInfo & { usage: UsageHoursInfo | null }> => {
    const user = (await ctx.runQuery(
      api.users.viewer,
      {}
    )) as BillingUser | null
    if (!user) throw new Error("Not authenticated.")

    const { autumn, customer, customerId } = await ensureAutumnCustomer(
      ctx,
      user
    )
    const scheduled = scheduledBasePlanSubscription(customer)
    const active = activeBasePlanSubscription(customer)

    if (scheduled) {
      await autumn.billing.update({
        cancelAction: "cancel_immediately",
        customerId,
        noBillingChanges: true,
        planId: scheduled.planId,
        ...(scheduled.id ? { subscriptionId: scheduled.id } : {}),
      })
    }

    if (active?.canceledAt) {
      await autumn.billing.update({
        cancelAction: "uncancel",
        customerId,
        noBillingChanges: true,
        planId: active.planId,
        ...(active.id ? { subscriptionId: active.id } : {}),
      })
    }

    const refreshedCustomer = await autumn.customers.getOrCreate(
      autumnCustomerParams(user)
    )

    return await livePlanInfoWithUsage(ctx, {
      customer: refreshedCustomer,
      userId: user._id,
    })
  },
})

export const recordWorkerUsage = action({
  args: {
    amountMicroUsd: v.number(),
    idempotencyKey: v.string(),
    metadata: v.optional(v.any()),
    resourceId: v.optional(v.string()),
    source: billingUsageSource,
    userId: v.id("users"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    return await recordUsageEvent(ctx, args)
  },
})

export const observeDaytonaSandboxForWorker = action({
  args: {
    cpu: v.number(),
    diskGiB: v.number(),
    memoryGiB: v.number(),
    observedAt: v.number(),
    sandboxId: v.string(),
    source: sandboxSegmentSource,
    state: daytonaBillingState,
    userId: v.id("users"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const { workerSecret, ...observation } = args
    requireWorkerSecret(workerSecret)
    const event = (await ctx.runMutation(
      internal.billing.applySandboxObservation,
      observation
    )) as SegmentUsageResult
    const result = event
      ? await trackUsageEvent(ctx, event)
      : ({ exhausted: false, tracked: true } satisfies TrackUsageResult)
    return {
      eventId: event?.eventId,
      exhausted: result.exhausted,
      observed: true,
    }
  },
})

export const observeCurrentUserDaytonaSandbox = action({
  args: {
    cpu: v.number(),
    diskGiB: v.number(),
    memoryGiB: v.number(),
    observedAt: v.number(),
    sandboxId: v.string(),
    source: sandboxSegmentSource,
    state: daytonaBillingState,
  },
  handler: async (ctx, args) => {
    const user = (await ctx.runQuery(
      api.users.viewer,
      {}
    )) as BillingUser | null
    if (!user) throw new Error("Not authenticated.")

    const ownsSandbox = await ctx.runQuery(api.codexRuns.ownsSandbox, {
      sandboxId: args.sandboxId,
    })
    if (!ownsSandbox) throw new Error("Sandbox not found.")

    const event = (await ctx.runMutation(
      internal.billing.applySandboxObservation,
      {
        ...args,
        userId: user._id,
      }
    )) as SegmentUsageResult
    const result = event
      ? await trackUsageEvent(ctx, event)
      : ({ exhausted: false, tracked: true } satisfies TrackUsageResult)
    return {
      eventId: event?.eventId,
      exhausted: result.exhausted,
      observed: true,
    }
  },
})

export const retryFailedUsageForWorker = action({
  args: {
    limit: v.optional(v.number()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const events = (await ctx.runQuery(internal.billing.failedUsageEvents, {
      limit: args.limit ?? 25,
    })) as UsageEventResult[]

    let tracked = 0
    for (const event of events) {
      const result = await trackUsageEvent(ctx, event)
      if (result.tracked) tracked += 1
    }

    return { tracked }
  },
})

export const upsertCustomerRecord = internalMutation({
  args: {
    autumnCustomerId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    planId: v.optional(billingPlanId),
    status: v.optional(v.string()),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existing = await ctx.db
      .query("billingCustomers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique()

    const patch = {
      autumnCustomerId: args.autumnCustomerId,
      email: args.email,
      name: args.name,
      ...(args.planId ? { planId: args.planId } : {}),
      ...(args.status ? { status: args.status } : {}),
      updatedAt: now,
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch)
      return existing._id
    }

    return await ctx.db.insert("billingCustomers", {
      ...patch,
      createdAt: now,
      userId: args.userId,
    })
  },
})

export const setCustomerPlan = internalMutation({
  args: {
    planId: v.optional(billingPlanId),
    status: v.optional(v.string()),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("billingCustomers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique()
    if (!existing) return

    // Patching with `undefined` clears the field, so a downgraded or canceled
    // customer correctly drops back to "no active plan".
    await ctx.db.patch(existing._id, {
      planId: args.planId,
      status: args.status,
      updatedAt: Date.now(),
    })
  },
})

export const userForBilling = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId)
  },
})

export const customerRecordForUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("billingCustomers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique()
  },
})

export const pendingUsageForUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await localUsageSummary(ctx, args.userId)
  },
})

export const failedUsageEvents = internalQuery({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("billingUsageEvents")
      .withIndex("by_status_updated", (q) => q.eq("status", "failed"))
      .take(Math.max(1, Math.min(100, Math.round(args.limit))))

    return rows.map(usageEventResult)
  },
})

export const enqueueUsageEvent = internalMutation({
  args: {
    amountMicroUsd: v.number(),
    idempotencyKey: v.string(),
    metadata: v.optional(v.any()),
    resourceId: v.optional(v.string()),
    source: billingUsageSource,
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<UsageEventResult> => {
    return await enqueueUsageEventInMutation(ctx, args)
  },
})

export const markUsageTracked = internalMutation({
  args: {
    eventId: v.id("billingUsageEvents"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      error: undefined,
      status: "tracked",
      trackedAt: Date.now(),
      updatedAt: Date.now(),
    })
  },
})

export const markUsageFailed = internalMutation({
  args: {
    error: v.string(),
    eventId: v.id("billingUsageEvents"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      error: args.error,
      status: "failed",
      updatedAt: Date.now(),
    })
  },
})

export const applySandboxObservation = internalMutation({
  args: {
    cpu: v.number(),
    diskGiB: v.number(),
    memoryGiB: v.number(),
    observedAt: v.number(),
    sandboxId: v.string(),
    source: sandboxSegmentSource,
    state: daytonaBillingState,
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<SegmentUsageResult> => {
    return await applySandboxObservationMutation(ctx, {
      resources: {
        cpu: Math.max(0, Math.round(args.cpu)),
        diskGiB: Math.max(0, Math.round(args.diskGiB)),
        memoryGiB: Math.max(0, Math.round(args.memoryGiB)),
      },
      sandboxId: args.sandboxId,
      source: args.source,
      state: args.state,
      userId: args.userId,
      observedAt: Math.max(0, Math.round(args.observedAt)),
    })
  },
})
