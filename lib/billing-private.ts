import {
  BILLING_FREE_PLAN_ID,
  BILLING_HOBBY_PLAN_ID,
  BILLING_PLUS_PLAN_ID,
  ceilMicroUsd,
  type BillingPlanId,
} from "./billing"

const INCLUDED_USAGE_ENV_BY_PLAN_ID = {
  [BILLING_FREE_PLAN_ID]: "AUTUMN_FREE_INCLUDED_MICRO_USD",
  [BILLING_HOBBY_PLAN_ID]: "AUTUMN_HOBBY_INCLUDED_MICRO_USD",
  [BILLING_PLUS_PLAN_ID]: "AUTUMN_PLUS_INCLUDED_MICRO_USD",
} satisfies Record<BillingPlanId, string>

export function readPlanIncludedMicroUsd(
  planId: BillingPlanId,
  env: Record<string, string | undefined> = process.env
) {
  const envName = INCLUDED_USAGE_ENV_BY_PLAN_ID[planId]
  const rawValue = env[envName]

  if (!rawValue) {
    throw new Error(`Set ${envName} before syncing Autumn billing config.`)
  }

  const amountMicroUsd = Number(rawValue)
  if (
    !Number.isFinite(amountMicroUsd) ||
    amountMicroUsd <= 0 ||
    !Number.isInteger(amountMicroUsd)
  ) {
    throw new Error(`${envName} must be a positive integer micro-usd amount.`)
  }

  return ceilMicroUsd(amountMicroUsd)
}
