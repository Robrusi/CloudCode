import { tasks } from "@trigger.dev/sdk"
import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import {
  jsonError,
  jsonNumberField,
  jsonStringField,
  readJsonRecord,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import type { reviewRun } from "@/trigger/reviews"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const reviewId = jsonStringField(body, "reviewId") as
      | Id<"reviews">
      | undefined
    const prNumber = jsonNumberField(body, "prNumber")
    if (!reviewId) return jsonError("reviewId is required.", 400)
    if (!prNumber || !Number.isInteger(prNumber) || prNumber <= 0) {
      return jsonError("prNumber must be a positive integer.", 400)
    }

    const client = await currentUserConvexHttpClient()
    const review = await client.query(api.reviews.get, { reviewId })
    if (!review) return jsonError("Review not found.", 404)

    // Reuses the whole webhook path (billing check, GitHub token mint, run
    // creation, comment posting), so manual and webhook runs cannot drift
    // apart. PR details are resolved inside the task with the worker
    // credential.
    const handle = await tasks.trigger<typeof reviewRun>(
      "review-run",
      { manual: true, prNumber, reviewId },
      {
        idempotencyKey: `${reviewId}:manual:${randomUUID()}`,
        tags: [`user:${review.userId}`, `review:${reviewId}`],
      }
    )

    return NextResponse.json({ triggered: true, triggerRunId: handle.id })
  } catch (error) {
    console.error("/api/reviews/run-now failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to run review.",
      500
    )
  }
}
