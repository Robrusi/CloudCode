import { v } from "convex/values"

import { api, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server"
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server"
import { getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"
import {
  BILLING_DAYTONA_CHECKPOINT_MS,
  BILLING_FREE_PLAN_ID,
  BILLING_INFRA_USAGE_FEATURE_ID,
  BILLING_MINIMUM_START_BALANCE_MICRO_USD,
  BILLING_PLANS,
  DAYTONA_BILLING_RATE_VERSION,
  DAYTONA_REFERENCE_SANDBOX_RESOURCES,
  ceilMicroUsd,
  daytonaBurnRateMicroUsdPerSecond,
  daytonaSegmentMicroUsd,
  microUsdHoursLeft,
  microUsdMinutesLeft,
  type BillingPlanId,
  type BillingUsageSource,
  type DaytonaBillingResources,
  type DaytonaBillingState,
} from "../lib/billing"

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

type BillingUser = Pick<
  Doc<"users">,
  "_id" | "email" | "name" | "subject" | "tokenIdentifier"
>

type UsageEventResult = {
  amountMicroUsd: number
  eventId: Id<"billingUsageEvents">
  idempotencyKey: string
  metadata?: unknown
  resourceId?: string
  source: BillingUsageSource
  status: "pending" | "tracked" | "failed"
  userId: Id<"users">
}

type SegmentUsageResult = UsageEventResult | null
type TrackUsageResult = {
  exhausted: boolean
  tracked: boolean
}
type LocalUsageSummary = {
  activeSandboxSegments: number
  failedMicroUsd: number
  pendingMicroUsd: number
  trackedMicroUsd: number
}

function autumnCustomerId(userId: Id<"users">) {
  return userId as string
}

type ActivePlanInfo = {
  canceling: boolean
  currentPeriodEnd: number | null
  planId: BillingPlanId | null
  scheduledPlanId: BillingPlanId | null
  status: string | null
}

type AutumnPlanSubscription = {
  addOn?: boolean
  canceledAt?: number | null
  currentPeriodEnd?: number | null
  id?: string
  planId: string
  status?: string
}

const KNOWN_PLAN_IDS = new Set<string>(BILLING_PLANS.map((plan) => plan.planId))
const PLAN_RANK_BY_ID = new Map<string, number>(
  BILLING_PLANS.map((plan) => [plan.planId, plan.priceUsd])
)

function highestRankedSubscription<
  T extends {
    planId: string
  },
>(subscriptions: T[]) {
  let selected: T | undefined
  let selectedRank = -1
  for (const subscription of subscriptions) {
    const rank = PLAN_RANK_BY_ID.get(subscription.planId) ?? 0
    if (!selected || rank > selectedRank) {
      selected = subscription
      selectedRank = rank
    }
  }
  return selected
}

function basePlanSubscriptions(customer: {
  subscriptions?: AutumnPlanSubscription[]
}) {
  return (customer.subscriptions ?? []).filter(
    (subscription) =>
      !subscription.addOn && KNOWN_PLAN_IDS.has(subscription.planId)
  )
}

function activeBasePlanSubscription(customer: {
  subscriptions?: AutumnPlanSubscription[]
}) {
  return highestRankedSubscription(
    basePlanSubscriptions(customer).filter((entry) => entry.status === "active")
  )
}

function scheduledBasePlanSubscription(customer: {
  subscriptions?: AutumnPlanSubscription[]
}) {
  return highestRankedSubscription(
    basePlanSubscriptions(customer).filter(
      (entry) => entry.status === "scheduled"
    )
  )
}

async function livePlanInfoWithUsage(
  ctx: ActionCtx,
  {
    customer,
    userId,
  }: {
    customer: {
      balances?: Record<
        string,
        {
          granted?: number
          nextResetAt?: number | null
          remaining?: number
          unlimited?: boolean
        }
      >
      subscriptions?: AutumnPlanSubscription[]
    }
    userId: Id<"users">
  }
): Promise<ActivePlanInfo & { usage: UsageHoursInfo | null }> {
  const plan = resolveActivePlan(customer)

  await ctx.runMutation(internal.billing.setCustomerPlan, {
    planId: plan.planId ?? undefined,
    status: plan.status ?? undefined,
    userId,
  })

  const summary = (await ctx.runQuery(internal.billing.pendingUsageForUser, {
    userId,
  })) as LocalUsageSummary
  const usage = computeUsageHours(customer, summary.pendingMicroUsd)

  return { ...plan, usage }
}

/**
 * Derives the customer's current base plan from the live Autumn subscriptions.
 * The local `billingCustomers.planId` is only written on a direct attach, so
 * hosted-checkout subscriptions must be read back from Autumn to be reflected.
 */
function resolveActivePlan(customer: {
  subscriptions?: AutumnPlanSubscription[]
}): ActivePlanInfo {
  const candidates = basePlanSubscriptions(customer)
  const subscription =
    activeBasePlanSubscription(customer) ??
    highestRankedSubscription(candidates)
  const scheduledSubscription = scheduledBasePlanSubscription(customer)

  if (!subscription) {
    return {
      canceling: false,
      currentPeriodEnd: null,
      planId: null,
      scheduledPlanId: scheduledSubscription
        ? (scheduledSubscription.planId as BillingPlanId)
        : null,
      status: null,
    }
  }

  return {
    canceling: subscription.canceledAt != null,
    currentPeriodEnd: subscription.currentPeriodEnd ?? null,
    planId: subscription.planId as BillingPlanId,
    scheduledPlanId: scheduledSubscription
      ? (scheduledSubscription.planId as BillingPlanId)
      : null,
    status: subscription.status ?? null,
  }
}

type UsageHoursInfo = {
  depleted: boolean
  fractionRemaining: number
  nextResetAt: number | null
  runningHoursLeft: number
  runningMinutesLeft: number
  stoppedHoursLeft: number
  stoppedMinutesLeft: number
  unlimited: boolean
}

/**
 * Projects the customer's authoritative Autumn infra balance into a coarse
 * "time left" estimate, hiding the raw allowance from the browser. The local
 * pending/failed usage (not yet settled on Autumn) is subtracted first.
 */
function computeUsageHours(
  customer: {
    balances?: Record<
      string,
      {
        granted?: number
        nextResetAt?: number | null
        remaining?: number
        unlimited?: boolean
      }
    >
  },
  pendingMicroUsd: number
): UsageHoursInfo | null {
  const balance = customer.balances?.[BILLING_INFRA_USAGE_FEATURE_ID]
  if (!balance) return null

  const unlimited = Boolean(balance.unlimited)
  const remainingRaw =
    typeof balance.remaining === "number" ? balance.remaining : 0
  const grantedRaw = typeof balance.granted === "number" ? balance.granted : 0
  const remainingMicroUsd = Math.max(
    0,
    remainingRaw - Math.max(0, pendingMicroUsd)
  )

  const runningBurn = daytonaBurnRateMicroUsdPerSecond({
    resources: DAYTONA_REFERENCE_SANDBOX_RESOURCES,
    state: "running",
  })
  const stoppedBurn = daytonaBurnRateMicroUsdPerSecond({
    resources: DAYTONA_REFERENCE_SANDBOX_RESOURCES,
    state: "stopped",
  })

  return {
    depleted: !unlimited && remainingMicroUsd <= 0,
    fractionRemaining: unlimited
      ? 1
      : grantedRaw > 0
        ? Math.min(1, Math.max(0, remainingMicroUsd / grantedRaw))
        : 0,
    nextResetAt: balance.nextResetAt ?? null,
    runningHoursLeft: Math.floor(
      microUsdHoursLeft(remainingMicroUsd, runningBurn)
    ),
    runningMinutesLeft: Math.floor(
      microUsdMinutesLeft(remainingMicroUsd, runningBurn)
    ),
    stoppedHoursLeft: Math.floor(
      microUsdHoursLeft(remainingMicroUsd, stoppedBurn)
    ),
    stoppedMinutesLeft: Math.floor(
      microUsdMinutesLeft(remainingMicroUsd, stoppedBurn)
    ),
    unlimited,
  }
}

function cleanError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 1_000 ? `${message.slice(0, 997)}...` : message
}

function sanitizeAmount(amountMicroUsd: number) {
  if (!Number.isFinite(amountMicroUsd)) {
    throw new Error("Usage amount must be finite.")
  }
  return ceilMicroUsd(amountMicroUsd)
}

function sameResources(
  a: Pick<Doc<"billingSandboxSegments">, "cpu" | "diskGiB" | "memoryGiB">,
  b: DaytonaBillingResources
) {
  return (
    a.cpu === b.cpu && a.diskGiB === b.diskGiB && a.memoryGiB === b.memoryGiB
  )
}

function usageMetadata(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

async function checkRemainingInfraAccess(
  ctx: ActionCtx,
  {
    autumn,
    customerId,
    requiredMicroUsd = BILLING_MINIMUM_START_BALANCE_MICRO_USD,
    userId,
    withPreview = false,
  }: {
    autumn: Awaited<ReturnType<typeof autumnClient>>
    customerId: string
    requiredMicroUsd?: number
    userId: Id<"users">
    withPreview?: boolean
  }
) {
  const summary = (await ctx.runQuery(internal.billing.pendingUsageForUser, {
    userId,
  })) as LocalUsageSummary
  const requiredBalance =
    sanitizeAmount(requiredMicroUsd) + summary.pendingMicroUsd
  const check = await autumn.check({
    customerId,
    featureId: BILLING_INFRA_USAGE_FEATURE_ID,
    requiredBalance,
    withPreview,
  })

  return {
    allowed: check.allowed,
    requiredBalance,
  }
}

async function localUsageSummary(
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

  return {
    activeSandboxSegments: activeSegments.length,
    failedMicroUsd: rows
      .filter((row) => row.status === "failed")
      .reduce((sum, row) => sum + row.amountMicroUsd, 0),
    pendingMicroUsd: rows
      .filter((row) => row.status === "pending" || row.status === "failed")
      .reduce((sum, row) => sum + row.amountMicroUsd, 0),
    trackedMicroUsd: rows
      .filter((row) => row.status === "tracked")
      .reduce((sum, row) => sum + row.amountMicroUsd, 0),
  }
}

async function autumnClient() {
  const secretKey = process.env.AUTUMN_SECRET_KEY
  if (!secretKey) {
    throw new Error("Set AUTUMN_SECRET_KEY before using billing.")
  }

  const { Autumn } = await import("autumn-js")
  return new Autumn({ secretKey, timeoutMs: 15_000 })
}

function autumnCustomerParams(user: BillingUser) {
  return {
    autoEnablePlanId: BILLING_FREE_PLAN_ID,
    customerId: autumnCustomerId(user._id),
    email: user.email,
    fingerprint: user.subject || user.tokenIdentifier,
    metadata: { convexUserId: user._id },
    name: user.name,
  }
}

async function ensureAutumnCustomer(ctx: ActionCtx, user: BillingUser) {
  const customerId = autumnCustomerId(user._id)
  const autumn = await autumnClient()
  let customer = await autumn.customers.getOrCreate(autumnCustomerParams(user))
  let plan = resolveActivePlan(customer)

  if (!activeBasePlanSubscription(customer)) {
    const response = await autumn.billing.attach({
      customerId,
      planId: BILLING_FREE_PLAN_ID,
      redirectMode: "never",
    })
    customer = await autumn.customers.getOrCreate(autumnCustomerParams(user))
    plan = resolveActivePlan(customer)

    await ctx.runMutation(internal.billing.upsertCustomerRecord, {
      autumnCustomerId: customerId,
      email: user.email,
      name: user.name,
      planId: plan.planId ?? BILLING_FREE_PLAN_ID,
      status:
        plan.status ?? (response.paymentUrl ? "checkout_required" : "active"),
      userId: user._id,
    })

    return { autumn, customer, customerId }
  }

  await ctx.runMutation(internal.billing.upsertCustomerRecord, {
    autumnCustomerId: customerId,
    email: user.email,
    name: user.name,
    planId: plan.planId ?? BILLING_FREE_PLAN_ID,
    status: plan.status ?? undefined,
    userId: user._id,
  })
  return { autumn, customer, customerId }
}

async function trackUsageEvent(
  ctx: ActionCtx,
  event: UsageEventResult
): Promise<TrackUsageResult> {
  if (event.status === "tracked" || event.amountMicroUsd <= 0) {
    if (event.status !== "tracked") {
      await ctx.runMutation(internal.billing.markUsageTracked, {
        eventId: event.eventId,
      })
    }
    return { exhausted: false, tracked: true }
  }

  const user = await ctx.runQuery(internal.billing.userForBilling, {
    userId: event.userId,
  })
  if (!user) throw new Error("Billing user not found.")

  const { autumn, customerId } = await ensureAutumnCustomer(ctx, user)
  try {
    await autumn.track(
      {
        customerId,
        featureId: BILLING_INFRA_USAGE_FEATURE_ID,
        properties: {
          ...usageMetadata(event.metadata),
          idempotencyKey: event.idempotencyKey,
          resourceId: event.resourceId,
          source: event.source,
        },
        value: event.amountMicroUsd,
      },
      {
        headers: {
          "Idempotency-Key": event.idempotencyKey,
        },
      }
    )
    await ctx.runMutation(internal.billing.markUsageTracked, {
      eventId: event.eventId,
    })
    try {
      const access = await checkRemainingInfraAccess(ctx, {
        autumn,
        customerId,
        userId: event.userId,
      })
      return { exhausted: !access.allowed, tracked: true }
    } catch (error) {
      console.warn("Unable to check remaining billing balance.", error)
      return { exhausted: false, tracked: true }
    }
  } catch (error) {
    await ctx.runMutation(internal.billing.markUsageFailed, {
      error: cleanError(error),
      eventId: event.eventId,
    })
    try {
      const access = await checkRemainingInfraAccess(ctx, {
        autumn,
        customerId,
        userId: event.userId,
      })
      if (!access.allowed) {
        return { exhausted: true, tracked: false }
      }
    } catch (checkError) {
      console.warn("Unable to check remaining billing balance.", checkError)
    }
    throw error
  }
}

async function recordUsageEvent(
  ctx: ActionCtx,
  args: {
    amountMicroUsd: number
    idempotencyKey: string
    metadata?: unknown
    resourceId?: string
    source: BillingUsageSource
    userId: Id<"users">
  }
) {
  const event = (await ctx.runMutation(internal.billing.enqueueUsageEvent, {
    amountMicroUsd: args.amountMicroUsd,
    idempotencyKey: args.idempotencyKey,
    metadata: args.metadata,
    resourceId: args.resourceId,
    source: args.source,
    userId: args.userId,
  })) as UsageEventResult

  const result = await trackUsageEvent(ctx, event)
  return { eventId: event.eventId, ...result }
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

    return rows.map(
      (row): UsageEventResult => ({
        amountMicroUsd: row.amountMicroUsd,
        eventId: row._id,
        idempotencyKey: row.idempotencyKey,
        metadata: row.metadata,
        resourceId: row.resourceId,
        source: row.source,
        status: row.status,
        userId: row.userId,
      })
    )
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
    const amountMicroUsd = sanitizeAmount(args.amountMicroUsd)
    const existing = await ctx.db
      .query("billingUsageEvents")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .unique()
    if (existing) {
      return {
        amountMicroUsd: existing.amountMicroUsd,
        eventId: existing._id,
        idempotencyKey: existing.idempotencyKey,
        metadata: existing.metadata,
        resourceId: existing.resourceId,
        source: existing.source,
        status: existing.status,
        userId: existing.userId,
      }
    }

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

async function applySandboxObservationMutation(
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
  const active = activeSegments.sort((a, b) => b.startedAt - a.startedAt)[0]
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

async function enqueueUsageEventInMutation(
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
  const existing = await ctx.db
    .query("billingUsageEvents")
    .withIndex("by_idempotency_key", (q) =>
      q.eq("idempotencyKey", args.idempotencyKey)
    )
    .unique()
  if (existing) {
    return {
      amountMicroUsd: existing.amountMicroUsd,
      eventId: existing._id,
      idempotencyKey: existing.idempotencyKey,
      metadata: existing.metadata,
      resourceId: existing.resourceId,
      source: existing.source,
      status: existing.status,
      userId: existing.userId,
    }
  }

  const now = Date.now()
  const eventId = await ctx.db.insert("billingUsageEvents", {
    amountMicroUsd: sanitizeAmount(args.amountMicroUsd),
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
    amountMicroUsd: sanitizeAmount(args.amountMicroUsd),
    eventId,
    idempotencyKey: args.idempotencyKey,
    metadata: args.metadata,
    resourceId: args.resourceId,
    source: args.source,
    status: "pending",
    userId: args.userId,
  }
}
