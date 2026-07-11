import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"

import { getConvexAuthToken } from "@/lib/codex/auth"
import { jsonError } from "@/lib/http/api-route"
import {
  SLACK_BOT_SCOPES,
  SLACK_OAUTH_STATE_COOKIE,
  slackIntegrationEnv,
} from "@/lib/integrations/config"
import { SLACK_MCP_USER_SCOPES } from "@/lib/integrations/mcp"

export const runtime = "nodejs"

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize"

export async function GET(request: Request) {
  const env = slackIntegrationEnv()
  if (!env) {
    return jsonError("The Slack integration is not configured.", 503)
  }
  if (env.mode !== "oauth") {
    return jsonError(
      "Slack runs in token mode (SLACK_BOT_TOKEN); use Connect in settings instead of the OAuth flow.",
      400
    )
  }

  try {
    await getConvexAuthToken()
  } catch {
    return jsonError("Sign in before connecting Slack.", 401)
  }

  const url = new URL(request.url)
  const redirectUri = `${url.origin}/api/slack/oauth/callback`
  const state = randomBytes(24).toString("base64url")

  const authorizeUrl = new URL(SLACK_AUTHORIZE_URL)
  authorizeUrl.searchParams.set("client_id", env.clientId)
  authorizeUrl.searchParams.set("redirect_uri", redirectUri)
  authorizeUrl.searchParams.set("scope", SLACK_BOT_SCOPES.join(","))
  authorizeUrl.searchParams.set("user_scope", SLACK_MCP_USER_SCOPES.join(","))
  authorizeUrl.searchParams.set("state", state)

  const response = NextResponse.redirect(authorizeUrl)
  response.cookies.set(SLACK_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 15 * 60,
    path: "/api/slack/oauth",
    sameSite: "lax",
    secure: url.protocol === "https:",
  })
  return response
}
