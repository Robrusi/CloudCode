"use client"

import { useAction, useQuery } from "convex/react"
import { Check, Clock, CreditCard, Loader2, X } from "lucide-react"
import { useEffect, useReducer } from "react"

import {
  navDestructive,
  navPrimary,
  SettingsPage,
  statusBadge,
  statusIdle,
  statusOk,
} from "@/components/settings/shared"
import { api } from "@/convex/_generated/api"
import {
  BILLING_PLANS,
  type BillingPlanId,
  type UsageHoursInfo,
  planIncludedTimeLabel,
} from "@/lib/billing/model"
import { cn } from "@/lib/shared/utils"

type BillingPlanDetail = {
  canceling: boolean
  currentPeriodEnd: number | null
  scheduledPlanId: BillingPlanId | null
}

type LiveBillingPlan = BillingPlanDetail & {
  usage: UsageHoursInfo | null
}

type BillingSettingsState = {
  busyPlanId: BillingPlanId | null
  cancelingScheduledPlan: boolean
  error: string
  planDetail: BillingPlanDetail | null
  syncing: boolean
  usage: UsageHoursInfo | null
}

type BillingSettingsAction =
  | { type: "cancel-finish" }
  | { type: "cancel-start" }
  | { error: string; type: "error" }
  | { plan: LiveBillingPlan; type: "plan-loaded" }
  | { plan: LiveBillingPlan; type: "sync-loaded" }
  | { type: "sync-failed" }
  | { type: "sync-start" }
  | { planId: BillingPlanId; type: "purchase-start" }
  | { type: "purchase-finish" }

const initialBillingSettingsState: BillingSettingsState = {
  busyPlanId: null,
  cancelingScheduledPlan: false,
  error: "",
  planDetail: null,
  syncing: true,
  usage: null,
}

function livePlanDetail(plan: LiveBillingPlan): BillingPlanDetail {
  return {
    canceling: plan.canceling,
    currentPeriodEnd: plan.currentPeriodEnd,
    scheduledPlanId: plan.scheduledPlanId,
  }
}

function billingSettingsReducer(
  state: BillingSettingsState,
  action: BillingSettingsAction
): BillingSettingsState {
  switch (action.type) {
    case "cancel-finish":
      return { ...state, cancelingScheduledPlan: false }
    case "cancel-start":
      return { ...state, cancelingScheduledPlan: true, error: "" }
    case "error":
      return { ...state, error: action.error }
    case "plan-loaded":
      return {
        ...state,
        planDetail: livePlanDetail(action.plan),
        usage: action.plan.usage,
      }
    case "purchase-finish":
      return { ...state, busyPlanId: null }
    case "purchase-start":
      return { ...state, busyPlanId: action.planId, error: "" }
    case "sync-failed":
      return { ...state, syncing: false }
    case "sync-loaded":
      return {
        ...state,
        planDetail: livePlanDetail(action.plan),
        syncing: false,
        usage: action.plan.usage,
      }
    case "sync-start":
      return { ...state, syncing: true }
  }
}

function formatSandboxTimeLeft(usage: UsageHoursInfo) {
  if (usage.depleted) return "0 minutes"
  if (usage.runningHoursLeft >= 1) {
    return `${usage.runningHoursLeft} ${usage.runningHoursLeft === 1 ? "hour" : "hours"}`
  }
  if (usage.runningMinutesLeft >= 1) {
    return `${usage.runningMinutesLeft} ${usage.runningMinutesLeft === 1 ? "minute" : "minutes"}`
  }
  return "<1 minute"
}

function formatPlanPrice(priceUsd: number) {
  return priceUsd === 0 ? "Free" : `$${priceUsd}/mo`
}

function billingPlanRank(planId: string | null | undefined) {
  return BILLING_PLANS.find((plan) => plan.planId === planId)?.priceUsd ?? 0
}

function formatPlanDetail({
  canceling,
  currentPeriodEnd,
  currentPlanId,
  scheduledPlanId,
}: {
  canceling: boolean
  currentPeriodEnd: number | null
  currentPlanId: string | null | undefined
  scheduledPlanId: BillingPlanId | null
}) {
  if (scheduledPlanId && scheduledPlanId !== currentPlanId) {
    const verb =
      billingPlanRank(scheduledPlanId) < billingPlanRank(currentPlanId)
        ? "Downgrades"
        : "Changes"
    return `${verb} to ${billingPlanName(scheduledPlanId)} next billing cycle`
  }

  if (canceling && currentPeriodEnd) {
    return `Cancels ${formatBillingDate(currentPeriodEnd)}`
  }

  if (currentPeriodEnd) {
    return `Renews ${formatBillingDate(currentPeriodEnd)}`
  }

  return "Your current plan"
}

export function BillingSettings() {
  const billing = useQuery(api.billing.viewer)
  const attachPlan = useAction(api.billing.attachCurrentUserPlan)
  const cancelScheduledPlan = useAction(
    api.billing.cancelCurrentUserScheduledPlan
  )
  const refreshPlan = useAction(api.billing.refreshCurrentUserPlan)
  const [state, dispatch] = useReducer(
    billingSettingsReducer,
    initialBillingSettingsState
  )
  const {
    busyPlanId,
    cancelingScheduledPlan,
    error,
    planDetail,
    syncing,
    usage,
  } = state
  const currentPlanId = billing?.customer?.planId

  // The local record only stores the plan after a direct attach; hosted
  // checkouts settle on Autumn. Pull the live subscription so the page always
  // shows the real plan.
  useEffect(() => {
    let cancelled = false
    dispatch({ type: "sync-start" })
    refreshPlan({})
      .then((plan) => {
        if (cancelled) return
        dispatch({ plan, type: "sync-loaded" })
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "sync-failed" })
      })
    return () => {
      cancelled = true
    }
  }, [refreshPlan])

  const checking = !currentPlanId && (billing === undefined || syncing)

  async function purchasePlan(planId: BillingPlanId) {
    if (busyPlanId) return

    dispatch({ planId, type: "purchase-start" })

    try {
      const successUrl = new URL(window.location.origin)
      successUrl.searchParams.set("view", "settings")
      const result = await attachPlan({
        planId,
        successUrl: successUrl.toString(),
      })

      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl)
        return
      }

      // Direct attach with no hosted checkout — pull the live renewal details.
      const plan = await refreshPlan({})
      dispatch({ plan, type: "plan-loaded" })
    } catch (err) {
      dispatch({
        error: err instanceof Error ? err.message : "Unable to start checkout.",
        type: "error",
      })
    } finally {
      dispatch({ type: "purchase-finish" })
    }
  }

  async function cancelPlanChange() {
    if (busyPlanId || cancelingScheduledPlan) return

    dispatch({ type: "cancel-start" })

    try {
      const plan = await cancelScheduledPlan({})
      dispatch({ plan, type: "plan-loaded" })
    } catch (err) {
      dispatch({
        error:
          err instanceof Error ? err.message : "Unable to cancel plan change.",
        type: "error",
      })
    } finally {
      dispatch({ type: "cancel-finish" })
    }
  }

  return (
    <SettingsPage
      title="Billing"
      description="Manage your subscription. Payments are handled securely through Autumn."
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <CreditCard className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            {checking ? (
              <div className="text-sm text-muted-foreground">
                Checking your plan…
              </div>
            ) : currentPlanId ? (
              <>
                <div className="text-sm font-medium text-foreground">
                  {billingPlanName(currentPlanId)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatPlanDetail({
                    canceling: Boolean(planDetail?.canceling),
                    currentPeriodEnd: planDetail?.currentPeriodEnd ?? null,
                    currentPlanId,
                    scheduledPlanId: planDetail?.scheduledPlanId ?? null,
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-foreground">
                  No active plan
                </div>
                <div className="text-xs text-muted-foreground">
                  Choose a plan to get started
                </div>
              </>
            )}
          </div>
          {checking ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        {usage ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {usage.unlimited ? (
                  <span className="font-medium text-foreground">
                    Unlimited sandbox usage
                  </span>
                ) : (
                  <>
                    <span className="font-medium text-foreground tabular-nums">
                      {formatSandboxTimeLeft(usage)}
                    </span>{" "}
                    of sandbox time left
                  </>
                )}
              </span>
              {usage.nextResetAt && !usage.unlimited ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  resets {formatBillingDate(usage.nextResetAt)}
                </span>
              ) : null}
            </div>

            <div
              aria-hidden
              className="relative h-2 w-full rounded-full bg-muted"
            >
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-[width]",
                  usage.fractionRemaining <= 0.15
                    ? "bg-destructive"
                    : "bg-foreground"
                )}
                style={{
                  width: usage.depleted
                    ? "0%"
                    : `${Math.max(usage.fractionRemaining * 100, 2)}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="text-[11px] leading-4 text-destructive">{error}</div>
        ) : null}

        <div className="divide-y divide-border/60 border-y border-border/60">
          {BILLING_PLANS.map((plan) => {
            const busy = busyPlanId === plan.planId
            const active = currentPlanId === plan.planId
            const scheduled = planDetail?.scheduledPlanId === plan.planId

            return (
              <div key={plan.planId} className="flex items-center gap-3 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {plan.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatPlanPrice(plan.priceUsd)} ·{" "}
                    {planIncludedTimeLabel(plan.includedMicroUsd)} of usage
                  </div>
                </div>
                {active ? (
                  <span className={cn(statusBadge, statusOk)}>
                    <Check className="size-3.5" />
                    Current plan
                  </span>
                ) : scheduled ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={cn(statusBadge, statusIdle)}>
                      <Clock className="size-3.5" />
                      Next cycle
                    </span>
                    <button
                      type="button"
                      disabled={Boolean(busyPlanId) || cancelingScheduledPlan}
                      onClick={() => void cancelPlanChange()}
                      className={navDestructive}
                    >
                      {cancelingScheduledPlan ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <X className="size-3.5" />
                      )}
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(busyPlanId)}
                    onClick={() => void purchasePlan(plan.planId)}
                    className={navPrimary}
                  >
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Choose
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </SettingsPage>
  )
}

function billingPlanName(planId: string) {
  return BILLING_PLANS.find((plan) => plan.planId === planId)?.name ?? planId
}

function formatBillingDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}
