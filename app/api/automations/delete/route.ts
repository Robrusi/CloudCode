import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { jsonError, readJsonStringField } from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const automationId = (await readJsonStringField(
      request,
      "automationId"
    )) as Id<"automations"> | undefined
    if (!automationId) return jsonError("automationId is required.", 400)

    const client = await currentUserConvexHttpClient()
    await client.mutation(api.automations.remove, { automationId })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("/api/automations/delete failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to delete automation.",
      400
    )
  }
}
