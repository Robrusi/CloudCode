import { NextResponse } from "next/server"

import {
  jsonError,
  jsonRawStringField,
  readJsonRecord,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import { disconnectMcpOauthConnection } from "@/lib/mcp/oauth-connections"
import { mcpOauthProvider } from "@/lib/mcp/oauth-providers"

export const runtime = "nodejs"

export async function DELETE(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const provider = mcpOauthProvider(jsonRawStringField(body, "provider"))
    if (!provider) {
      return jsonError("Unknown MCP provider.", 400)
    }

    const result = await disconnectMcpOauthConnection(provider)
    return NextResponse.json(result)
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to disconnect the MCP connection.",
      400
    )
  }
}
