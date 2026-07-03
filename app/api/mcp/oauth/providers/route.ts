import { NextResponse } from "next/server"

import { getConvexAuthToken } from "@/lib/codex/auth"
import { jsonError } from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import { MCP_OAUTH_PROVIDERS } from "@/lib/mcp/oauth-providers"

export const runtime = "nodejs"

// Reports which OAuth providers still need their pre-registered client
// credentials configured, so the settings UI can guide setup instead of
// sending users into a failing OAuth redirect.
export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    await getConvexAuthToken()

    const setupRequired = MCP_OAUTH_PROVIDERS.filter((provider) => {
      const staticClient = provider.staticClientEnv
      if (!staticClient) return false
      return (
        !process.env[staticClient.clientIdVar]?.trim() ||
        !process.env[staticClient.clientSecretVar]?.trim()
      )
    }).map((provider) => provider.id)

    return NextResponse.json({ setupRequired })
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to load MCP provider status.",
      401
    )
  }
}
