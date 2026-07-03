import { NextResponse } from "next/server"

import { getConvexAuthToken } from "@/lib/codex/auth"
import { jsonError } from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import { listMcpProvidersNeedingSetup } from "@/lib/mcp/oauth-connections"
import { MCP_OAUTH_PROVIDERS } from "@/lib/mcp/oauth-providers"

export const runtime = "nodejs"

// Reports which OAuth providers still need their pre-registered client
// credentials, so the settings UI can guide setup instead of sending users
// into a failing OAuth redirect. Credentials pasted in the setup dialog or
// deployment env vars both satisfy a provider.
export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    await getConvexAuthToken()

    const setupRequired =
      await listMcpProvidersNeedingSetup(MCP_OAUTH_PROVIDERS)

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
