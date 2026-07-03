import { NextRequest, NextResponse } from "next/server"

import { getConvexAuthToken } from "@/lib/codex/auth"
import { requireSameOrigin } from "@/lib/http/request-security"
import {
  MCP_OAUTH_COOKIE_PATH,
  MCP_OAUTH_PROVIDER_COOKIE,
  MCP_OAUTH_STATE_COOKIE,
  MCP_OAUTH_VERIFIER_COOKIE,
  mcpOauthRedirectUri,
  startMcpOauthConnection,
  type McpSuppliedOauthClient,
} from "@/lib/mcp/oauth-connections"
import {
  mcpOauthProvider,
  type McpOauthProvider,
} from "@/lib/mcp/oauth-providers"
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

async function startAuthorization(
  url: URL,
  provider: McpOauthProvider,
  options: { redirectStatus: number; suppliedClient?: McpSuppliedOauthClient }
) {
  const { authorizationUrl, state, verifier } = await startMcpOauthConnection({
    provider,
    redirectUri: mcpOauthRedirectUri(url.origin),
    suppliedClient: options.suppliedClient,
  })

  const response = NextResponse.redirect(
    authorizationUrl,
    options.redirectStatus
  )
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
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    await getConvexAuthToken()

    const provider = mcpOauthProvider(url.searchParams.get("provider"))
    if (!provider) return html("Unknown MCP provider.")

    return await startAuthorization(url, provider, { redirectStatus: 307 })
  } catch (error) {
    return html(
      error instanceof Error
        ? error.message
        : "Unable to start MCP authorization."
    )
  }
}

// The setup dialog posts pasted OAuth app credentials here so providers
// without dynamic client registration connect immediately: the credentials
// are stored encrypted with the user's connection, never placed in a URL.
export async function POST(request: NextRequest) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const url = new URL(request.url)
    await getConvexAuthToken()

    const form = await request.formData()
    const provider = mcpOauthProvider(String(form.get("provider") ?? ""))
    if (!provider) return html("Unknown MCP provider.")

    const clientId = String(form.get("clientId") ?? "").trim()
    const clientSecret = String(form.get("clientSecret") ?? "").trim()
    if (!clientId || !clientSecret) {
      return html(
        `Enter both the ${provider.name} client ID and client secret.`
      )
    }

    // 303 so the browser follows the redirect to the provider with a GET.
    return await startAuthorization(url, provider, {
      redirectStatus: 303,
      suppliedClient: { clientId, clientSecret },
    })
  } catch (error) {
    return html(
      error instanceof Error
        ? error.message
        : "Unable to start MCP authorization."
    )
  }
}
