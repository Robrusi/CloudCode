import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import {
  jsonError,
  jsonStringField,
  readJsonRecord,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import { parseReviewRequestConfig } from "@/lib/reviews/request"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const reviewId = jsonStringField(body, "reviewId")
    if (!reviewId) return jsonError("reviewId is required.", 400)

    const config = parseReviewRequestConfig(body)

    const client = await currentUserConvexHttpClient()
    await client.mutation(api.reviews.update, {
      authorFilterMode: config.authorFilterMode,
      authorFilters: config.authorFilters,
      autoEnvironment: config.autoEnvironment,
      autofix: config.autofix,
      model: config.model,
      name: config.name,
      profile: config.profile,
      prompt: config.prompt,
      reasoningEffort: config.reasoningEffort,
      repoUrl: config.repoUrl,
      reviewId: reviewId as Id<"reviews">,
      reviewReadyForReview: config.reviewReadyForReview,
      sandboxPresetId: config.sandboxPresetId as
        | Id<"sandboxPresets">
        | undefined,
      speed: config.speed,
    })

    return NextResponse.json({ reviewId })
  } catch (error) {
    console.error("/api/reviews/update failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to update review.",
      400
    )
  }
}
