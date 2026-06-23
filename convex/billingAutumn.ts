import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import type { ActionCtx } from "./_generated/server"
import {
  BILLING_FREE_PLAN_ID,
  BILLING_INFRA_USAGE_FEATURE_ID,
  redeemCodeFailureFromAutumnCode,
  type BillingUsageSource,
  type RedeemCodeFailure,
  type UsageHoursInfo,
} from "@/lib/billing/model"
import {
  activeBasePlanSubscription,
  computeUsageHours,
  resolveActivePlan,
  type ActivePlanInfo,
  type AutumnPlanSubscription,
} from "./billingPlan"
import {
  cleanUsageError,
  sanitizeUsageAmount,
  usageMetadata,
  type TrackUsageResult,
  type UsageEventResult,
} from "./billingUsageEvents"
import type { LocalUsageSummary } from "./billingSandboxSegments"

const BILLING_MINIMUM_START_BALANCE_MICRO_USD = 10_000

export type BillingUser = Pick<
  Doc<"users">,
  "_id" | "email" | "name" | "subject" | "tokenIdentifier"
>

export function autumnCustomerId(userId: Id<"users">) {
  return userId as string
}

async function autumnClient() {
  const secretKey = process.env.AUTUMN_SECRET_KEY
  if (!secretKey) {
    throw new Error("Set AUTUMN_SECRET_KEY before using billing.")
  }

  const { Autumn } = await import("autumn-js")
  return new Autumn({ secretKey, timeoutMs: 15_000 })
}

export function autumnCustomerParams(user: BillingUser) {
  return {
    autoEnablePlanId: BILLING_FREE_PLAN_ID,
    customerId: autumnCustomerId(user._id),
    email: user.email,
    fingerprint: user.subject || user.tokenIdentifier,
    metadata: { convexUserId: user._id },
    name: user.name,
  }
}

export async function livePlanInfoWithUsage(
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

export async function ensureAutumnCustomer(ctx: ActionCtx, user: BillingUser) {
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

export type RedeemCodeResult =
  | { ok: true; plan: ActivePlanInfo & { usage: UsageHoursInfo | null } }
  | { ok: false; reason: RedeemCodeFailure }

/** Pull Autumn's error code out of whatever shape the SDK throws. */
function autumnErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined

  const direct = (error as { code?: unknown }).code
  if (typeof direct === "string") return direct

  // The SDK's AutumnError carries the raw JSON response body.
  const body = (error as { body?: unknown }).body
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as { code?: unknown }
      if (typeof parsed.code === "string") return parsed.code
    } catch {
      // Body was not JSON; fall through to undefined.
    }
  }

  return undefined
}

export async function redeemRewardCode(
  ctx: ActionCtx,
  user: BillingUser,
  code: string
): Promise<RedeemCodeResult> {
  const { autumn, customerId } = await ensureAutumnCustomer(ctx, user)

  try {
    await autumn.rewards.redeemCode({ code, customerId })
  } catch (error) {
    const reason = redeemCodeFailureFromAutumnCode(autumnErrorCode(error))
    // Surface unexpected failures in logs so misconfigured rewards are visible.
    if (reason === "unknown") {
      console.error("Reward code redemption failed.", error)
    }
    return { ok: false, reason }
  }

  // Re-pull the customer so the granted balance is reflected immediately.
  const customer = await autumn.customers.getOrCreate(
    autumnCustomerParams(user)
  )
  const plan = await livePlanInfoWithUsage(ctx, { customer, userId: user._id })
  return { ok: true, plan }
}

export async function checkRemainingInfraAccess(
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
    sanitizeUsageAmount(requiredMicroUsd) + summary.pendingMicroUsd
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

export async function trackUsageEvent(
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
      error: cleanUsageError(error),
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

export async function recordUsageEvent(
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
