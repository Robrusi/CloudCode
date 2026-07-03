import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import { nextRunAtAfter } from "@/lib/automations/schedule"
import { parseAutomationRequestConfig } from "@/lib/automations/request"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { jsonError, readJsonRecord } from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import type { Id } from "@/convex/_generated/dataModel"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const config = parseAutomationRequestConfig(body)
    const nextRunAt = nextRunAtAfter(config.cron, config.timezone, Date.now())

    const client = await currentUserConvexHttpClient()
    const created = await client.mutation(api.automations.create, {
      autoEnvironment: config.autoEnvironment,
      baseBranch: config.baseBranch,
      branchMode: config.branchMode,
      branchName: config.branchName,
      cron: config.cron,
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
      timezone: config.timezone,
    })

    return NextResponse.json({
      automationId: created.automationId,
      nextRunAt,
      threadId: created.threadId,
    })
  } catch (error) {
    console.error("/api/automations failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to create automation.",
      400
    )
  }
}
