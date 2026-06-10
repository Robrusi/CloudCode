export const BILLING_INFRA_USAGE_FEATURE_ID = "infra_usage"
export const BILLING_USAGE_UNIT = "micro_usd"
export const BILLING_MICRO_USD_PER_USD = 1_000_000
export const BILLING_MICRO_USD_PER_CENT = BILLING_MICRO_USD_PER_USD / 100

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

export const DAYTONA_BILLING_RATE_VERSION = "daytona-2026-06-09"
export const DAYTONA_BILLING_RATES: DaytonaBillingRates = {
  cpuMicroUsdPerVcpuSecond: 14,
  memoryMicroUsdPerGibSecond: 4.5,
  storageMicroUsdPerGibSecond: 0.03,
}

export const BILLING_DAYTONA_CHECKPOINT_MS = 60_000
export const BILLING_TRIGGER_CHECKPOINT_MS = 30_000
export const BILLING_MINIMUM_START_BALANCE_MICRO_USD = 10_000
export const BILLING_MAX_SETTLEMENT_DELAY_MS = 48 * 60 * 60 * 1000

export function billingPlanForId(planId: string | undefined | null) {
  return BILLING_PLANS.find((plan) => plan.planId === planId)
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

export function microUsdToUsd(value: number) {
  return value / BILLING_MICRO_USD_PER_USD
}

export function formatMicroUsd(value: number) {
  return `$${microUsdToUsd(value).toFixed(4)}`
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

export function daytonaSegmentMicroUsd({
  durationMs,
  rates = DAYTONA_BILLING_RATES,
  resources,
  state,
}: {
  durationMs: number
  rates?: DaytonaBillingRates
  resources: DaytonaBillingResources
  state: DaytonaBillingState
}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0
  if (state === "archived" || state === "deleted") return 0

  const seconds = durationMs / 1000
  const storage =
    resources.diskGiB * rates.storageMicroUsdPerGibSecond * seconds

  if (state === "stopped") return ceilMicroUsd(storage)

  const cpu = resources.cpu * rates.cpuMicroUsdPerVcpuSecond * seconds
  const memory =
    resources.memoryGiB * rates.memoryMicroUsdPerGibSecond * seconds

  return ceilMicroUsd(cpu + memory + storage)
}

/**
 * Representative sandbox profile used to project a remaining balance into
 * "hours left" on the billing page. Mirrors the Daytona sandbox defaults
 * (DEFAULT_SANDBOX_CPU / MEMORY / DISK in lib/daytona-sandbox.ts).
 */
export const DAYTONA_REFERENCE_SANDBOX_RESOURCES: DaytonaBillingResources = {
  cpu: 2,
  diskGiB: 8,
  memoryGiB: 4,
}

/**
 * Exact (unrounded) Daytona burn rate in micro_usd per second. A running
 * sandbox bills CPU + memory + disk; a stopped sandbox bills disk only.
 */
export function daytonaBurnRateMicroUsdPerSecond({
  rates = DAYTONA_BILLING_RATES,
  resources,
  state,
}: {
  rates?: DaytonaBillingRates
  resources: DaytonaBillingResources
  state: "running" | "stopped"
}) {
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
export function planIncludedHours(includedMicroUsd: number) {
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

export function planIncludedMinutes(includedMicroUsd: number) {
  return Math.floor(
    microUsdMinutesLeft(
      includedMicroUsd,
      daytonaBurnRateMicroUsdPerSecond({
        resources: DAYTONA_REFERENCE_SANDBOX_RESOURCES,
        state: "running",
      })
    )
  )
}

export function planIncludedDisplayMinutes(includedMicroUsd: number) {
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

export function readDaytonaBillingRatesFromEnv(
  env: Record<string, string | undefined> = process.env
): DaytonaBillingRates {
  return {
    cpuMicroUsdPerVcpuSecond: readPositiveEnvNumber(
      env.DAYTONA_BILLING_CPU_MICRO_USD_PER_VCPU_SECOND,
      DAYTONA_BILLING_RATES.cpuMicroUsdPerVcpuSecond
    ),
    memoryMicroUsdPerGibSecond: readPositiveEnvNumber(
      env.DAYTONA_BILLING_MEMORY_MICRO_USD_PER_GIB_SECOND,
      DAYTONA_BILLING_RATES.memoryMicroUsdPerGibSecond
    ),
    storageMicroUsdPerGibSecond: readPositiveEnvNumber(
      env.DAYTONA_BILLING_STORAGE_MICRO_USD_PER_GIB_SECOND,
      DAYTONA_BILLING_RATES.storageMicroUsdPerGibSecond
    ),
  }
}

function readPositiveEnvNumber(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}
