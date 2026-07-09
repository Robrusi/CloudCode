import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { nextRunAtAfter } from "@/lib/automations/schedule"
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
    const automationId = jsonStringField(body, "automationId") as
      | Id<"automations">
      | undefined
    const enabled = jsonBooleanField(body, "enabled")
    if (!automationId) return jsonError("automationId is required.", 400)
    if (enabled === undefined) return jsonError("enabled is required.", 400)

    const client = await currentUserConvexHttpClient()
    let nextRunAt: number | undefined
    if (enabled) {
      const automation = await client.query(api.automations.get, {
        automationId,
      })
      if (!automation) return jsonError("Automation not found.", 404)
      // Event-triggered automations have no schedule; only cron automations
      // re-arm nextRunAt when re-enabled.
      if (automation.cron) {
        nextRunAt = nextRunAtAfter(
          automation.cron,
          automation.timezone ?? "UTC",
          Date.now()
        )
      }
    }

    await client.mutation(api.automations.setEnabled, {
      automationId,
      enabled,
      nextRunAt,
    })

    return NextResponse.json({ automationId, enabled, nextRunAt })
  } catch (error) {
    console.error("/api/automations/toggle failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to update automation.",
      400
    )
  }
}
