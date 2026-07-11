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
  MODELS,
  THINKINGS,
  type Model,
  type Thinking,
} from "@/lib/chat/options"
import {
  integrationsStateRedisUrl,
  linearIntegrationEnv,
  slackIntegrationEnv,
} from "@/lib/integrations/config"
import { getInitializedIntegrationsBot } from "@/lib/integrations/bot"
import { revokeSlackToken } from "@/lib/integrations/slack-oauth"
import { decryptSecret } from "@/lib/security/secret-crypto"
import { getWorkerSecret } from "@/lib/security/worker-secret"

export const runtime = "nodejs"

/** Installation list plus env readiness, so the settings tiles can tell
 * "server not configured" apart from "not connected yet". */
export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const client = await currentUserConvexHttpClient()
    // Additive rollout: an older Convex deployment may not expose the
    // idempotent backfill yet; status must remain readable while it catches up.
    await client
      .mutation(api.integrations.ensureManagedMcpServers, {})
      .catch(() => undefined)
    const installations = await client.query(api.integrations.list, {})

    const slackEnv = slackIntegrationEnv()
    return NextResponse.json({
      installations: installations.map((installation) => ({
        ...installation,
        mcpEnabled: installation.mcpEnabled ?? true,
        mcpReady: installation.mcpReady ?? installation.provider === "linear",
      })),
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

    const rawModel = jsonStringField(body, "defaultModel")
    if (rawModel && !(MODELS as readonly string[]).includes(rawModel)) {
      return jsonError(`model must be one of ${MODELS.join(", ")}.`, 400)
    }
    const rawEffort = jsonStringField(body, "defaultReasoningEffort")
    if (rawEffort && !(THINKINGS as readonly string[]).includes(rawEffort)) {
      return jsonError(
        `reasoningEffort must be one of ${THINKINGS.join(", ")}.`,
        400
      )
    }
    // "" for the preset means "clear back to the auto default".
    const rawPreset = jsonRawStringField(body, "defaultSandboxPresetId")

    const client = await currentUserConvexHttpClient()
    await client.mutation(api.integrations.updateSettings, {
      clearDefaultSandboxPreset: rawPreset === "" ? true : undefined,
      defaultBaseBranch: jsonRawStringField(body, "defaultBaseBranch"),
      defaultModel: rawModel as Model | undefined,
      defaultReasoningEffort: rawEffort as Thinking | undefined,
      defaultRepoUrl: jsonRawStringField(body, "defaultRepoUrl"),
      defaultSandboxPresetId: rawPreset
        ? (rawPreset as Id<"sandboxPresets">)
        : undefined,
      enabled: jsonBooleanField(body, "enabled"),
      installationId,
      mcpEnabled: jsonBooleanField(body, "mcpEnabled"),
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
    const installation = await client.query(
      api.integrations.getInstallationForDisconnect,
      { installationId, workerSecret: getWorkerSecret() }
    )
    if (!installation) return jsonError("Integration not found.", 404)

    let revokeError: string | undefined
    if (
      installation.provider === "slack" &&
      installation.encryptedMcpAccessToken
    ) {
      await revokeSlackToken(
        decryptSecret(installation.encryptedMcpAccessToken)
      ).catch((error) => {
        revokeError =
          error instanceof Error ? error.message : "Token revocation failed."
      })
    }

    await getInitializedIntegrationsBot()
      .then(async ({ linear, slack }) => {
        if (installation.provider === "slack") {
          const slackEnv = slackIntegrationEnv()
          if (slackEnv?.mode === "oauth") {
            const stored = await slack?.getInstallation(installation.externalId)
            if (stored?.botToken) {
              await revokeSlackToken(stored.botToken).catch((error) => {
                revokeError ??=
                  error instanceof Error
                    ? error.message
                    : "Bot token revocation failed."
              })
            }
          }
          await slack?.deleteInstallation(installation.externalId)
        } else {
          await linear?.deleteInstallation(installation.externalId)
        }
      })
      .catch(() => undefined)

    await client.mutation(api.integrations.removeInstallation, {
      installationId,
    })

    return NextResponse.json({ removed: true, revokeError })
  } catch (error) {
    console.error("/api/integrations DELETE failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to remove integration.",
      400
    )
  }
}
