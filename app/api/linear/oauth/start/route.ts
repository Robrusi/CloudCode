import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"

import { getConvexAuthToken } from "@/lib/codex/auth"
import { jsonError } from "@/lib/http/api-route"
import {
  LINEAR_OAUTH_STATE_COOKIE,
  linearIntegrationEnv,
} from "@/lib/integrations/config"

export const runtime = "nodejs"

const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize"

// The agent scopes require actor=app: the app installs as a workspace agent
// that can be @mentioned and assigned issues (agent sessions).
const LINEAR_SCOPES = "read,write,app:assignable,app:mentionable"

export async function GET(request: Request) {
  const env = linearIntegrationEnv()
  if (!env) {
    return jsonError("The Linear integration is not configured.", 503)
  }

  try {
    await getConvexAuthToken()
  } catch {
    return jsonError("Sign in before connecting Linear.", 401)
  }

  const url = new URL(request.url)
  const redirectUri = `${url.origin}/api/linear/oauth/callback`
  const state = randomBytes(24).toString("base64url")

  const authorizeUrl = new URL(LINEAR_AUTHORIZE_URL)
  authorizeUrl.searchParams.set("actor", "app")
  authorizeUrl.searchParams.set("client_id", env.clientId)
  authorizeUrl.searchParams.set("prompt", "consent")
  authorizeUrl.searchParams.set("redirect_uri", redirectUri)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("scope", LINEAR_SCOPES)
  authorizeUrl.searchParams.set("state", state)

  const response = NextResponse.redirect(authorizeUrl)
  response.cookies.set(LINEAR_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 15 * 60,
    path: "/api/linear/oauth",
    sameSite: "lax",
    secure: url.protocol === "https:",
  })
  return response
}
