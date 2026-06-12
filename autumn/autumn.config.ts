import { feature, item, plan, type AutumnConfig } from "atmn"
import { loadEnvConfig } from "@next/env"

import {
  BILLING_FREE_PLAN_ID,
  BILLING_HOBBY_PLAN_ID,
  BILLING_INFRA_USAGE_FEATURE_ID,
  BILLING_PLUS_PLAN_ID,
  ceilMicroUsd,
  type BillingPlanId,
} from "@/lib/billing/model"

loadEnvConfig(process.cwd())

const INCLUDED_USAGE_ENV_BY_PLAN_ID = {
  [BILLING_FREE_PLAN_ID]: "AUTUMN_FREE_INCLUDED_MICRO_USD",
  [BILLING_HOBBY_PLAN_ID]: "AUTUMN_HOBBY_INCLUDED_MICRO_USD",
  [BILLING_PLUS_PLAN_ID]: "AUTUMN_PLUS_INCLUDED_MICRO_USD",
} satisfies Record<BillingPlanId, string>

function readPlanIncludedMicroUsd(
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

export const infraUsage = feature({
  consumable: true,
  id: BILLING_INFRA_USAGE_FEATURE_ID,
  name: "Infrastructure usage",
  type: "metered",
})

export const free = plan({
  group: "base",
  id: BILLING_FREE_PLAN_ID,
  items: [
    item({
      featureId: infraUsage.id,
      included: readPlanIncludedMicroUsd(BILLING_FREE_PLAN_ID),
      reset: { interval: "month" },
    }),
  ],
  name: "Free",
})

export const hobby = plan({
  group: "base",
  id: BILLING_HOBBY_PLAN_ID,
  items: [
    item({
      featureId: infraUsage.id,
      included: readPlanIncludedMicroUsd(BILLING_HOBBY_PLAN_ID),
      reset: { interval: "month" },
    }),
  ],
  name: "Hobby",
  price: { amount: 10, interval: "month" },
})

export const plus = plan({
  group: "base",
  id: BILLING_PLUS_PLAN_ID,
  items: [
    item({
      featureId: infraUsage.id,
      included: readPlanIncludedMicroUsd(BILLING_PLUS_PLAN_ID),
      reset: { interval: "month" },
    }),
  ],
  name: "Plus",
  price: { amount: 20, interval: "month" },
})

export default {
  features: [infraUsage],
  plans: [free, hobby, plus],
} satisfies AutumnConfig
