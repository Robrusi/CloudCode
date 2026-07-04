import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import {
  jsonBooleanField,
  jsonError,
  jsonStringField,
  readJsonRecord,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const reviewId = jsonStringField(body, "reviewId") as
      | Id<"reviews">
      | undefined
    const enabled = jsonBooleanField(body, "enabled")
    if (!reviewId) return jsonError("reviewId is required.", 400)
    if (enabled === undefined) return jsonError("enabled is required.", 400)

    const client = await currentUserConvexHttpClient()
    await client.mutation(api.reviews.setEnabled, { enabled, reviewId })

    return NextResponse.json({ enabled, reviewId })
  } catch (error) {
    console.error("/api/reviews/toggle failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to update review.",
      400
    )
  }
}
