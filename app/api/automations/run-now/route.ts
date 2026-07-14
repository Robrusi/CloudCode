import { tasks } from "@trigger.dev/sdk"
import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { convexErrorMessage } from "@/lib/convex/errors"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { automationTriggerOf } from "@/convex/lib/integrationTriggers"
import { manualEventContext } from "@/lib/automations/manual-event"
import {
  jsonError,
  jsonStringField,
  readJsonRecord,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import type { automationRun } from "@/trigger/automations"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const automationId = jsonStringField(body, "automationId") as
      | Id<"automations">
      | undefined
    if (!automationId) return jsonError("automationId is required.", 400)

    const client = await currentUserConvexHttpClient()
    const automation = await client.query(api.automations.get, {
      automationId,
    })
    if (!automation) return jsonError("Automation not found.", 404)
    const trigger = automationTriggerOf(automation)
    let eventVars: Record<string, string> | undefined
    if (trigger.kind !== "cron") {
      const rawValues = body.eventValues
      if (
        !rawValues ||
        typeof rawValues !== "object" ||
        Array.isArray(rawValues) ||
        Object.values(rawValues).some((value) => typeof value !== "string")
      ) {
        return jsonError("Test event values are required.", 400)
      }
      eventVars = manualEventContext(
        trigger,
        automation.repoUrl,
        rawValues as Record<string, string>
      )
    }

    // Reuses the whole scheduled path (billing check, GitHub token mint, run
    // creation), so manual and scheduled runs cannot drift apart.
    const handle = await tasks.trigger<typeof automationRun>(
      "automation-run",
      { automationId, eventVars, manual: true },
      {
        idempotencyKey: `${automationId}:manual:${randomUUID()}`,
        tags: [`user:${automation.userId}`, `automation:${automationId}`],
      }
    )

    return NextResponse.json({ triggered: true, triggerRunId: handle.id })
  } catch (error) {
    console.error("/api/automations/run-now failed", error)
    return jsonError(
      convexErrorMessage(error, "Unable to run automation."),
      500
    )
  }
}
