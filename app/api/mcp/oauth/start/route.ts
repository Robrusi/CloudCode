import { NextRequest, NextResponse } from "next/server"

import { getConvexAuthToken } from "@/lib/codex/auth"
import {
  MCP_OAUTH_COOKIE_PATH,
  MCP_OAUTH_PROVIDER_COOKIE,
  MCP_OAUTH_STATE_COOKIE,
  MCP_OAUTH_VERIFIER_COOKIE,
  mcpOauthRedirectUri,
  startMcpOauthConnection,
} from "@/lib/mcp/oauth-connections"
import { mcpOauthProvider } from "@/lib/mcp/oauth-providers"
import { escapeHtml } from "@/lib/shared/html-escape"

export const runtime = "nodejs"

function html(message: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Cloudcode MCP Connection</title><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><h1 style="font-size:1.25rem">MCP authorization could not start</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to Cloudcode</a></p></body>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      status: 400,
    }
  )
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    await getConvexAuthToken()

    const provider = mcpOauthProvider(url.searchParams.get("provider"))
    if (!provider) return html("Unknown MCP provider.")

    const { authorizationUrl, state, verifier } = await startMcpOauthConnection(
      {
        provider,
        redirectUri: mcpOauthRedirectUri(url.origin),
      }
    )

    const response = NextResponse.redirect(authorizationUrl)
    const cookieOptions = {
      httpOnly: true,
      maxAge: 15 * 60,
      path: MCP_OAUTH_COOKIE_PATH,
      sameSite: "lax" as const,
      secure: url.protocol === "https:",
    }
    response.cookies.set(MCP_OAUTH_STATE_COOKIE, state, cookieOptions)
    response.cookies.set(MCP_OAUTH_VERIFIER_COOKIE, verifier, cookieOptions)
    response.cookies.set(MCP_OAUTH_PROVIDER_COOKIE, provider.id, cookieOptions)

    return response
  } catch (error) {
    return html(
      error instanceof Error
        ? error.message
        : "Unable to start MCP authorization."
    )
  }
}
