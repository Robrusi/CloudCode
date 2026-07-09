import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { nextRunAtAfter } from "@/lib/automations/schedule"
import { parseAutomationRequestConfig } from "@/lib/automations/request"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import {
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
    const automationId = jsonStringField(body, "automationId")
    if (!automationId) return jsonError("automationId is required.", 400)

    const config = parseAutomationRequestConfig(body)
    const nextRunAt =
      config.trigger.kind === "cron"
        ? nextRunAtAfter(
            config.trigger.cron,
            config.trigger.timezone,
            Date.now()
          )
        : undefined

    const client = await currentUserConvexHttpClient()
    await client.mutation(api.automations.update, {
      automationId: automationId as Id<"automations">,
      autoEnvironment: config.autoEnvironment,
      baseBranch: config.baseBranch,
      branchMode: config.branchMode,
      branchName: config.branchName,
      model: config.model,
      name: config.name,
      nextRunAt,
      profile: config.profile,
      prompt: config.prompt,
      reasoningEffort: config.reasoningEffort,
      repoUrl: config.repoUrl,
      sandboxPresetId: config.sandboxPresetId as
        | Id<"sandboxPresets">
        | undefined,
      sandboxRetention: config.sandboxRetention,
      speed: config.speed,
      threadMode: config.threadMode,
      trigger: config.trigger,
    })

    return NextResponse.json({ automationId, nextRunAt })
  } catch (error) {
    console.error("/api/automations/update failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to update automation.",
      400
    )
  }
}
