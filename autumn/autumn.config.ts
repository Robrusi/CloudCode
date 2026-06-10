import { feature, item, plan, type AutumnConfig } from "atmn"
import { loadEnvConfig } from "@next/env"

import {
  BILLING_FREE_PLAN_ID,
  BILLING_HOBBY_PLAN_ID,
  BILLING_INFRA_USAGE_FEATURE_ID,
  BILLING_PLUS_PLAN_ID,
} from "../lib/billing"
import { readPlanIncludedMicroUsd } from "../lib/billing-private"

loadEnvConfig(process.cwd())

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
