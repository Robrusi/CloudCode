import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { jsonError } from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import { slackIntegrationEnv } from "@/lib/integrations/config"

export const runtime = "nodejs"

type SlackAuthTestResponse = {
  error?: string
  ok: boolean
  team?: string
  team_id?: string
  user_id?: string
}

// Single-workspace mode: the bot token lives in env, so "connecting" Slack
// means verifying that token against auth.test and recording the workspace
// (with its settings row) in Convex.
export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const env = slackIntegrationEnv()
  if (!env) {
    return jsonError(
      "Set SLACK_CLIENT_ID/SLACK_CLIENT_SECRET (or SLACK_BOT_TOKEN) and SLACK_SIGNING_SECRET on the server first.",
      503
    )
  }
  if (env.mode !== "token") {
    return jsonError(
      "Slack runs in OAuth mode; connect through /api/slack/oauth/start instead.",
      400
    )
  }

  try {
    const response = await fetch("https://slack.com/api/auth.test", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${env.botToken}` },
      method: "POST",
    })
    const auth = (await response.json()) as SlackAuthTestResponse
    if (!auth.ok || !auth.team_id) {
      return jsonError(
        `Slack rejected the bot token${auth.error ? ` (${auth.error})` : ""}.`,
        400
      )
    }

    const client = await currentUserConvexHttpClient()
    const saved = await client.mutation(api.integrations.saveInstallation, {
      botUserId: auth.user_id,
      externalId: auth.team_id,
      externalName: auth.team,
      provider: "slack",
    })

    return NextResponse.json({
      installationId: saved.installationId,
      teamId: auth.team_id,
      teamName: auth.team,
    })
  } catch (error) {
    console.error("/api/integrations/slack/connect failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to connect Slack.",
      500
    )
  }
}
