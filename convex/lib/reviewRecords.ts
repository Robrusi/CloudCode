import type { Doc } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { REVIEW_MAX_CONSECUTIVE_FAILURES } from "@/lib/reviews/config"

const REVIEW_ERROR_MAX_LENGTH = 500

function truncateError(error?: string) {
  if (!error) return undefined

  return error.length > REVIEW_ERROR_MAX_LENGTH
    ? `${error.slice(0, REVIEW_ERROR_MAX_LENGTH)}…`
    : error
}

export async function recordReviewRunOutcome(
  ctx: MutationCtx,
  run: Pick<Doc<"codexRuns">, "reviewId">,
  outcome: "succeeded" | "failed" | "canceled",
  error?: string
) {
  if (!run.reviewId) return
  const review = await ctx.db.get(run.reviewId)
  if (!review) return

  const now = Date.now()
  if (outcome === "succeeded") {
    await ctx.db.patch(review._id, {
      failureCount: 0,
      lastRunError: undefined,
      lastRunStatus: "succeeded",
      updatedAt: now,
    })
    return
  }
  if (outcome === "canceled") {
    await ctx.db.patch(review._id, {
      lastRunStatus: "canceled",
      updatedAt: now,
    })
    return
  }

  await recordReviewFailure(ctx, review, "failed", error)
}

// Consecutive failures auto-disable the review so a broken setup (revoked
// auth, deleted repo) does not burn sandbox time on every pull request.
export async function recordReviewFailure(
  ctx: MutationCtx,
  review: Doc<"reviews">,
  status: "failed" | "dispatch_failed",
  error?: string
) {
  const failureCount = review.failureCount + 1
  const disable =
    review.enabled && failureCount >= REVIEW_MAX_CONSECUTIVE_FAILURES
  const now = Date.now()

  await ctx.db.patch(review._id, {
    failureCount,
    lastRunAt: now,
    lastRunError: truncateError(error),
    lastRunStatus: status,
    ...(disable
      ? {
          disabledReason: `Disabled after ${failureCount} consecutive failed runs.`,
          enabled: false,
        }
      : {}),
    updatedAt: now,
  })
}

export async function disableReview(
  ctx: MutationCtx,
  review: Doc<"reviews">,
  reason: string
) {
  await ctx.db.patch(review._id, {
    disabledReason: reason,
    enabled: false,
    updatedAt: Date.now(),
  })
}
