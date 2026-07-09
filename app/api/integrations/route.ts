import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import {
  jsonBooleanField,
  jsonError,
  jsonRawStringField,
  jsonStringField,
  readJsonRecord,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import {
  integrationsStateRedisUrl,
  linearIntegrationEnv,
  slackIntegrationEnv,
} from "@/lib/integrations/config"

export const runtime = "nodejs"

/** Installation list plus env readiness, so the settings tiles can tell
 * "server not configured" apart from "not connected yet". */
export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const client = await currentUserConvexHttpClient()
    const installations = await client.query(api.integrations.list, {})

    const slackEnv = slackIntegrationEnv()
    return NextResponse.json({
      installations,
      linearConfigured: Boolean(linearIntegrationEnv()),
      slackConfigured: Boolean(slackEnv),
      slackMode: slackEnv?.mode ?? null,
      stateConfigured: Boolean(integrationsStateRedisUrl()),
    })
  } catch (error) {
    console.error("/api/integrations failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to load integrations.",
      500
    )
  }
}

export async function PATCH(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const installationId = jsonStringField(body, "installationId") as
      | Id<"integrationInstallations">
      | undefined
    if (!installationId) return jsonError("installationId is required.", 400)

    const client = await currentUserConvexHttpClient()
    await client.mutation(api.integrations.updateSettings, {
      defaultRepoUrl: jsonRawStringField(body, "defaultRepoUrl"),
      defaultSandboxPresetId: jsonStringField(
        body,
        "defaultSandboxPresetId"
      ) as Id<"sandboxPresets"> | undefined,
      enabled: jsonBooleanField(body, "enabled"),
      installationId,
    })

    return NextResponse.json({ installationId })
  } catch (error) {
    console.error("/api/integrations PATCH failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to update integration.",
      400
    )
  }
}

export async function DELETE(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const installationId = jsonStringField(body, "installationId") as
      | Id<"integrationInstallations">
      | undefined
    if (!installationId) return jsonError("installationId is required.", 400)

    const client = await currentUserConvexHttpClient()
    await client.mutation(api.integrations.removeInstallation, {
      installationId,
    })

    return NextResponse.json({ removed: true })
  } catch (error) {
    console.error("/api/integrations DELETE failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to remove integration.",
      400
    )
  }
}
