import type { Doc } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { AUTOMATION_MAX_CONSECUTIVE_FAILURES } from "@/lib/automations/config"

const AUTOMATION_ERROR_MAX_LENGTH = 500

function truncateError(error?: string) {
  if (!error) return undefined

  return error.length > AUTOMATION_ERROR_MAX_LENGTH
    ? `${error.slice(0, AUTOMATION_ERROR_MAX_LENGTH)}…`
    : error
}

export async function recordAutomationRunOutcome(
  ctx: MutationCtx,
  run: Pick<Doc<"codexRuns">, "automationId">,
  outcome: "succeeded" | "failed" | "canceled",
  error?: string
) {
  if (!run.automationId) return
  const automation = await ctx.db.get(run.automationId)
  if (!automation) return

  const now = Date.now()
  if (outcome === "succeeded") {
    await ctx.db.patch(automation._id, {
      failureCount: 0,
      lastRunError: undefined,
      lastRunStatus: "succeeded",
      updatedAt: now,
    })
    return
  }
  if (outcome === "canceled") {
    await ctx.db.patch(automation._id, {
      lastRunStatus: "canceled",
      updatedAt: now,
    })
    return
  }

  await recordAutomationFailure(ctx, automation, "failed", error)
}

// Consecutive failures auto-disable the automation so a broken setup (revoked
// auth, deleted repo) does not burn sandbox time every schedule slot.
export async function recordAutomationFailure(
  ctx: MutationCtx,
  automation: Doc<"automations">,
  status: "failed" | "dispatch_failed",
  error?: string
) {
  const failureCount = automation.failureCount + 1
  const disable =
    automation.enabled && failureCount >= AUTOMATION_MAX_CONSECUTIVE_FAILURES

  await ctx.db.patch(automation._id, {
    failureCount,
    lastRunError: truncateError(error),
    lastRunStatus: status,
    ...(disable
      ? {
          disabledReason: `Disabled after ${failureCount} consecutive failed runs.`,
          enabled: false,
          nextRunAt: undefined,
        }
      : {}),
    updatedAt: Date.now(),
  })
}

export async function disableAutomation(
  ctx: MutationCtx,
  automation: Doc<"automations">,
  reason: string
) {
  await ctx.db.patch(automation._id, {
    disabledReason: reason,
    enabled: false,
    nextRunAt: undefined,
    updatedAt: Date.now(),
  })
}
