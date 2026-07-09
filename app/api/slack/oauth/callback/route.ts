import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { getIntegrationsBot } from "@/lib/integrations/bot"
import {
  SLACK_OAUTH_STATE_COOKIE,
  slackIntegrationEnv,
} from "@/lib/integrations/config"
import { escapeHtml } from "@/lib/shared/html-escape"

export const runtime = "nodejs"

const SETTINGS_URL = "/?view=settings&section=connections"

function errorPage(message: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Cloudcode Slack</title><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><h1 style="font-size:1.25rem">Slack could not be connected</h1><p>${escapeHtml(message)}</p><p><a href="${SETTINGS_URL}">Return to settings</a></p></body>`,
    {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 400,
    }
  )
}

export async function GET(request: NextRequest) {
  const env = slackIntegrationEnv()
  if (!env || env.mode !== "oauth") {
    return errorPage("The Slack OAuth integration is not configured.")
  }

  const url = new URL(request.url)
  const state = url.searchParams.get("state")
  const expectedState = request.cookies.get(SLACK_OAUTH_STATE_COOKIE)?.value
  if (!state || !expectedState || state !== expectedState) {
    return errorPage("The authorization state did not match. Try again.")
  }

  try {
    const { slack } = getIntegrationsBot()
    if (!slack) return errorPage("The Slack integration is not configured.")

    // Exchanges the code and persists the workspace installation (bot token,
    // encrypted when SLACK_ENCRYPTION_KEY is set) in the Chat SDK state
    // store; Convex keeps only the settings row.
    const { installation, teamId } = await slack.handleOAuthCallback(request, {
      redirectUri: `${url.origin}/api/slack/oauth/callback`,
    })

    const client = await currentUserConvexHttpClient()
    await client.mutation(api.integrations.saveInstallation, {
      botUserId: installation.botUserId,
      externalId: teamId,
      externalName: installation.teamName,
      provider: "slack",
    })

    const response = NextResponse.redirect(new URL(SETTINGS_URL, url.origin))
    response.cookies.set(SLACK_OAUTH_STATE_COOKIE, "", {
      maxAge: 0,
      path: "/api/slack/oauth",
    })
    return response
  } catch (error) {
    console.error("/api/slack/oauth/callback failed", error)
    return errorPage(
      error instanceof Error ? error.message : "Authorization failed."
    )
  }
}
