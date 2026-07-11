import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { getInitializedIntegrationsBot } from "@/lib/integrations/bot"
import {
  SLACK_OAUTH_STATE_COOKIE,
  slackIntegrationEnv,
} from "@/lib/integrations/config"
import {
  exchangeSlackIntegrationCode,
  revokeSlackToken,
} from "@/lib/integrations/slack-oauth"
import { encryptSecret } from "@/lib/security/secret-crypto"
import { getWorkerSecret } from "@/lib/security/worker-secret"
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
    const { slack } = await getInitializedIntegrationsBot()
    if (!slack) return errorPage("The Slack integration is not configured.")

    const code = url.searchParams.get("code")
    if (!code) return errorPage("Slack did not return an authorization code.")
    // One exchange returns the bot token used by chat/webhooks and the user
    // token used by Slack's official MCP server.
    const { installation, mcpCredential, teamId } =
      await exchangeSlackIntegrationCode({
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        code,
        redirectUri: `${url.origin}/api/slack/oauth/callback`,
      })
    // Encrypt before any persistent writes so a missing deployment key cannot
    // leave a half-connected Slack installation.
    const encryptedAccessToken = encryptSecret(mcpCredential.accessToken)
    const encryptedRefreshToken = mcpCredential.refreshToken
      ? encryptSecret(mcpCredential.refreshToken)
      : undefined
    await slack.setInstallation(teamId, installation)

    const client = await currentUserConvexHttpClient()
    const saved = await client.mutation(api.integrations.saveInstallation, {
      botUserId: installation.botUserId,
      externalId: teamId,
      externalName: installation.teamName,
      provider: "slack",
    })
    await client
      .mutation(api.integrations.saveMcpCredential, {
        encryptedAccessToken,
        encryptedRefreshToken,
        expiresAt: mcpCredential.expiresAt,
        externalUserId: mcpCredential.externalUserId,
        installationId: saved.installationId,
        provider: "slack",
        scopes: mcpCredential.scopes,
        workerSecret: getWorkerSecret(),
      })
      .catch(async (error) => {
        // Chat remains connected if the web deployment reaches production
        // before the additive Convex credential mutation. Reconnecting after
        // Convex catches up completes MCP authorization.
        console.warn("Unable to persist Slack MCP authorization.", error)
        await revokeSlackToken(mcpCredential.accessToken).catch(() => undefined)
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
