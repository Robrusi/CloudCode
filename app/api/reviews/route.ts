import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { jsonError, readJsonRecord } from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import { parseReviewRequestConfig } from "@/lib/reviews/request"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const config = parseReviewRequestConfig(body)

    const client = await currentUserConvexHttpClient()
    const created = await client.mutation(api.reviews.create, {
      autoEnvironment: config.autoEnvironment,
      model: config.model,
      name: config.name,
      profile: config.profile,
      prompt: config.prompt,
      reasoningEffort: config.reasoningEffort,
      repoUrl: config.repoUrl,
      reviewReadyForReview: config.reviewReadyForReview,
      sandboxPresetId: config.sandboxPresetId as
        | Id<"sandboxPresets">
        | undefined,
      speed: config.speed,
    })

    return NextResponse.json({ reviewId: created.reviewId })
  } catch (error) {
    console.error("/api/reviews failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to create review.",
      400
    )
  }
}
