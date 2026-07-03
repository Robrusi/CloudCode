import { NextRequest, NextResponse } from "next/server"

import {
  MCP_OAUTH_COOKIE_PATH,
  MCP_OAUTH_PROVIDER_COOKIE,
  MCP_OAUTH_STATE_COOKIE,
  MCP_OAUTH_VERIFIER_COOKIE,
  completeMcpOauthConnection,
  mcpOauthRedirectUri,
} from "@/lib/mcp/oauth-connections"
import { mcpOauthProvider } from "@/lib/mcp/oauth-providers"
import { escapeHtml } from "@/lib/shared/html-escape"

export const runtime = "nodejs"

function html(message: string, status = 400) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Cloudcode MCP Connection</title><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><h1 style="font-size:1.25rem">MCP authorization failed</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to Cloudcode</a></p></body>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      status,
    }
  )
}

function clearOauthCookies(response: NextResponse) {
  for (const name of [
    MCP_OAUTH_PROVIDER_COOKIE,
    MCP_OAUTH_STATE_COOKIE,
    MCP_OAUTH_VERIFIER_COOKIE,
  ]) {
    response.cookies.set(name, "", {
      maxAge: 0,
      path: MCP_OAUTH_COOKIE_PATH,
    })
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const returnedState = url.searchParams.get("state")
  const oauthError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error")
  const expectedState = request.cookies.get(MCP_OAUTH_STATE_COOKIE)?.value
  const codeVerifier = request.cookies.get(MCP_OAUTH_VERIFIER_COOKIE)?.value
  const provider = mcpOauthProvider(
    request.cookies.get(MCP_OAUTH_PROVIDER_COOKIE)?.value
  )

  if (oauthError) {
    const response = html(oauthError)
    clearOauthCookies(response)
    return response
  }

  if (!code || !provider || !codeVerifier) {
    const response = html("Missing MCP authorization code or state.")
    clearOauthCookies(response)
    return response
  }

  const stateMatches =
    returnedState && expectedState && returnedState === expectedState
  if (!stateMatches) {
    const response = html("MCP authorization state did not match.")
    clearOauthCookies(response)
    return response
  }

  try {
    await completeMcpOauthConnection({
      code,
      codeVerifier,
      provider,
      redirectUri: mcpOauthRedirectUri(url.origin),
    })

    const response = NextResponse.redirect(
      new URL("/?view=settings&section=mcp", url.origin)
    )
    clearOauthCookies(response)
    return response
  } catch (error) {
    const response = html(
      error instanceof Error
        ? error.message
        : "Unable to complete MCP authorization."
    )
    clearOauthCookies(response)
    return response
  }
}
