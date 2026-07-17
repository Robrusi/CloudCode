export const BILLING_INFRA_USAGE_FEATURE_ID = "infra_usage"

/**
 * Thrown when a run must stop because the user's infrastructure usage is
 * exhausted. Distinguishes exhaustion (which must abort the run) from
 * transient billing errors (which must not) wherever billing results are
 * observed asynchronously.
 */
export class BillingExhaustedError extends Error {
  constructor() {
    super("Infrastructure usage is exhausted. The Daytona sandbox was paused.")
    this.name = "BillingExhaustedError"
  }
}
const BILLING_MICRO_USD_PER_USD = 1_000_000
const BILLING_MICRO_USD_PER_CENT = BILLING_MICRO_USD_PER_USD / 100

export const BILLING_FREE_PLAN_ID = "free"
export const BILLING_HOBBY_PLAN_ID = "hobby"
export const BILLING_PLUS_PLAN_ID = "plus"

export const BILLING_PLANS = [
  {
    includedMicroUsd: 50_000,
    name: "Free",
    planId: BILLING_FREE_PLAN_ID,
    priceUsd: 0,
  },
  {
    includedMicroUsd: 6_000_000,
    name: "Hobby",
    planId: BILLING_HOBBY_PLAN_ID,
    priceUsd: 10,
  },
  {
    includedMicroUsd: 14_000_000,
    name: "Plus",
    planId: BILLING_PLUS_PLAN_ID,
    priceUsd: 20,
  },
] as const

export type BillingPlanId = (typeof BILLING_PLANS)[number]["planId"]

/**
 * Why a reward / promo code redemption failed, normalized away from Autumn's
 * internal error codes so the same reason can be surfaced consistently on the
 * client (Convex redacts raw thrown error messages in production).
 */
export type RedeemCodeFailure =
  | "invalid"
  | "max_redemptions"
  | "already_redeemed"
  | "not_eligible"
  | "unavailable"
  | "unknown"

const REDEEM_CODE_FAILURE_MESSAGES: Record<RedeemCodeFailure, string> = {
  invalid: "That code isn’t valid. Double-check it and try again.",
  max_redemptions: "This code has reached its redemption limit.",
  already_redeemed: "You’ve already redeemed this code.",
  not_eligible: "This code is only available to new customers.",
  unavailable: "This code can’t be redeemed right now. Please try again later.",
  unknown: "We couldn’t redeem that code. Please try again.",
}

export function redeemCodeFailureMessage(reason: RedeemCodeFailure): string {
  return REDEEM_CODE_FAILURE_MESSAGES[reason]
}

/** Map an Autumn API error code onto a normalized redemption failure reason. */
export function redeemCodeFailureFromAutumnCode(
  autumnCode: string | null | undefined
): RedeemCodeFailure {
  switch (autumnCode) {
    case "reward_not_found":
    case "reward_program_not_found":
    case "referral_code_not_found":
    case "referral_not_found":
      return "invalid"
    case "referral_code_max_redemptions_reached":
      return "max_redemptions"
    case "customer_already_redeemed_referral_code":
      return "already_redeemed"
    case "promo_code_first_time_only":
      return "not_eligible"
    case "invalid_reward":
      return "unavailable"
    default:
      return "unknown"
  }
}

export type BillingUsageSource = "trigger" | "daytona" | "reconciliation"

export type DaytonaBillingState =
  | "running"
  | "stopped"
  | "archived"
  | "deleted"
  | "unknown"

export type DaytonaBillingResources = {
  cpu: number
  diskGiB: number
  memoryGiB: number
}

export type DaytonaBillingRates = {
  cpuMicroUsdPerVcpuSecond: number
  memoryMicroUsdPerGibSecond: number
  storageMicroUsdPerGibSecond: number
}

export type UsageHoursInfo = {
  depleted: boolean
  fractionRemaining: number
  nextResetAt: number | null
  runningHoursLeft: number
  runningMinutesLeft: number
  stoppedHoursLeft: number
  stoppedMinutesLeft: number
  unlimited: boolean
}

const DAYTONA_BILLING_RATES: DaytonaBillingRates = {
  cpuMicroUsdPerVcpuSecond: 14,
  memoryMicroUsdPerGibSecond: 4.5,
  storageMicroUsdPerGibSecond: 0.03,
}

export function microUsdFromTriggerCents(costInCents: number) {
  if (!Number.isFinite(costInCents) || costInCents <= 0) return 0
  return ceilMicroUsd(costInCents * BILLING_MICRO_USD_PER_CENT)
}

export function ceilMicroUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  const nearest = Math.round(value)
  if (Math.abs(value - nearest) < 1e-9) return nearest
  return Math.ceil(value)
}

export function daytonaBillingState(rawState: string | undefined | null) {
  switch (rawState) {
    case "archived":
    case "archiving":
      return "archived" satisfies DaytonaBillingState
    case "destroyed":
    case "destroying":
    case "deleted":
      return "deleted" satisfies DaytonaBillingState
    case "stopped":
    case "stopping":
      return "stopped" satisfies DaytonaBillingState
    case "started":
    case "starting":
    case "recovering":
    case "resizing":
      return "running" satisfies DaytonaBillingState
    default:
      return rawState ? "unknown" : "unknown"
  }
}

/**
 * Representative sandbox profile used to project a remaining balance into
 * "hours left" on the billing page. Mirrors the Daytona sandbox defaults
 * (DEFAULT_SANDBOX_CPU / MEMORY / DISK in lib/daytona/sandbox.ts).
 */
export const DAYTONA_REFERENCE_SANDBOX_RESOURCES: DaytonaBillingResources = {
  cpu: 2,
  diskGiB: 8,
  memoryGiB: 4,
}

/**
 * Exact (unrounded) Daytona burn rate in micro_usd per second.
 */
export function daytonaBurnRateMicroUsdPerSecond({
  rates = DAYTONA_BILLING_RATES,
  resources,
  state,
}: {
  rates?: DaytonaBillingRates
  resources: DaytonaBillingResources
  state: DaytonaBillingState
}) {
  if (state === "archived" || state === "deleted" || state === "unknown") {
    return 0
  }
  const storage = resources.diskGiB * rates.storageMicroUsdPerGibSecond
  if (state === "stopped") return storage
  const cpu = resources.cpu * rates.cpuMicroUsdPerVcpuSecond
  const memory = resources.memoryGiB * rates.memoryMicroUsdPerGibSecond
  return cpu + memory + storage
}

/** Hours a balance lasts at a given burn rate; 0 when depleted or idle-free. */
export function microUsdHoursLeft(
  remainingMicroUsd: number,
  burnRateMicroUsdPerSecond: number
) {
  if (
    !Number.isFinite(remainingMicroUsd) ||
    remainingMicroUsd <= 0 ||
    burnRateMicroUsdPerSecond <= 0
  ) {
    return 0
  }
  return remainingMicroUsd / burnRateMicroUsdPerSecond / 3600
}

/** Minutes a balance lasts at a given burn rate; 0 when depleted or idle-free. */
export function microUsdMinutesLeft(
  remainingMicroUsd: number,
  burnRateMicroUsdPerSecond: number
) {
  if (
    !Number.isFinite(remainingMicroUsd) ||
    remainingMicroUsd <= 0 ||
    burnRateMicroUsdPerSecond <= 0
  ) {
    return 0
  }
  return remainingMicroUsd / burnRateMicroUsdPerSecond / 60
}

/**
 * Whole hours of running sandbox time a plan's included allowance buys, using
 * the same reference sandbox as the "hours left" meter so the figures align.
 */
function planIncludedHours(includedMicroUsd: number) {
  return Math.floor(
    microUsdHoursLeft(
      includedMicroUsd,
      daytonaBurnRateMicroUsdPerSecond({
        resources: DAYTONA_REFERENCE_SANDBOX_RESOURCES,
        state: "running",
      })
    )
  )
}

function planIncludedDisplayMinutes(includedMicroUsd: number) {
  const exactMinutes = microUsdMinutesLeft(
    includedMicroUsd,
    daytonaBurnRateMicroUsdPerSecond({
      resources: DAYTONA_REFERENCE_SANDBOX_RESOURCES,
      state: "running",
    })
  )
  if (exactMinutes < 5) return Math.max(1, Math.floor(exactMinutes))
  return Math.max(5, Math.round(exactMinutes / 5) * 5)
}

export function planIncludedTimeLabel(includedMicroUsd: number) {
  const hours = planIncludedHours(includedMicroUsd)
  if (hours >= 1) return `${hours} ${hours === 1 ? "hour" : "hours"}`

  const minutes = planIncludedDisplayMinutes(includedMicroUsd)
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
}
