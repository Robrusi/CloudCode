import { tasks } from "@trigger.dev/sdk"
import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { jsonError, readJsonStringField } from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import type { automationRun } from "@/trigger/automations"

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
    const automation = await client.query(api.automations.get, {
      automationId,
    })
    if (!automation) return jsonError("Automation not found.", 404)

    // Reuses the whole scheduled path (billing check, GitHub token mint, run
    // creation), so manual and scheduled runs cannot drift apart.
    const handle = await tasks.trigger<typeof automationRun>(
      "automation-run",
      { automationId, manual: true },
      {
        idempotencyKey: `${automationId}:manual:${randomUUID()}`,
        tags: [`user:${automation.userId}`, `automation:${automationId}`],
      }
    )

    return NextResponse.json({ triggered: true, triggerRunId: handle.id })
  } catch (error) {
    console.error("/api/automations/run-now failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to run automation.",
      500
    )
  }
}
