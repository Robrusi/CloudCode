import {
  BILLING_FREE_PLAN_ID,
  BILLING_INFRA_USAGE_FEATURE_ID,
  BILLING_PLANS,
  DAYTONA_REFERENCE_SANDBOX_RESOURCES,
  daytonaBurnRateMicroUsdPerSecond,
  microUsdHoursLeft,
  microUsdMinutesLeft,
  type BillingPlanId,
  type UsageHoursInfo,
} from "@/lib/billing/model"

export type ActivePlanInfo = {
  canceling: boolean
  currentPeriodEnd: number | null
  planId: BillingPlanId | null
  scheduledPlanId: BillingPlanId | null
  status: string | null
}

export type AutumnPlanSubscription = {
  addOn?: boolean
  autoEnable?: boolean
  canceledAt?: number | null
  currentPeriodEnd?: number | null
  id?: string
  planId: string
  status?: string
}

type AutumnCustomerWithPlan = {
  subscriptions?: AutumnPlanSubscription[]
}

type AutumnCustomerWithBalance = {
  balances?: Record<
    string,
    {
      granted?: number
      nextResetAt?: number | null
      remaining?: number
      unlimited?: boolean
    }
  >
}

const KNOWN_PLAN_IDS = new Set<string>(BILLING_PLANS.map((plan) => plan.planId))
const PLAN_RANK_BY_ID = new Map<string, number>(
  BILLING_PLANS.map((plan) => [plan.planId, plan.priceUsd])
)

function highestRankedSubscription<T extends { planId: string }>(
  subscriptions: T[]
) {
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

function basePlanSubscriptions(customer: AutumnCustomerWithPlan) {
  return (customer.subscriptions ?? []).filter(
    (subscription) =>
      !subscription.addOn && KNOWN_PLAN_IDS.has(subscription.planId)
  )
}

export function hasBasePlanSubscription(customer: AutumnCustomerWithPlan) {
  return basePlanSubscriptions(customer).length > 0
}

export function activeBasePlanSubscription(customer: AutumnCustomerWithPlan) {
  return highestRankedSubscription(
    basePlanSubscriptions(customer).filter((entry) => entry.status === "active")
  )
}

export function autoEnabledScheduledFreeBasePlanSubscriptions(
  customer: AutumnCustomerWithPlan
) {
  return basePlanSubscriptions(customer).filter(
    (entry) =>
      entry.planId === BILLING_FREE_PLAN_ID &&
      entry.status === "scheduled" &&
      entry.autoEnable === true
  )
}

export function scheduledBasePlanSubscription(
  customer: AutumnCustomerWithPlan
) {
  return highestRankedSubscription(
    basePlanSubscriptions(customer).filter(
      (entry) => entry.status === "scheduled"
    )
  )
}

/**
 * Derives the customer's current base plan from the live Autumn subscriptions.
 * The local `billingCustomers.planId` is only written on a direct attach, so
 * hosted-checkout subscriptions must be read back from Autumn to be reflected.
 */
export function resolveActivePlan(
  customer: AutumnCustomerWithPlan
): ActivePlanInfo {
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

/**
 * Projects the customer's authoritative Autumn infra balance into a coarse
 * "time left" estimate, hiding the raw allowance from the browser. The local
 * pending/failed usage (not yet settled on Autumn) is subtracted first.
 */
export function computeUsageHours(
  customer: AutumnCustomerWithBalance,
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
