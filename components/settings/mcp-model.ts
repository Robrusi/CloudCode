import type { Id } from "@/convex/_generated/dataModel"
import type { McpServerRecord } from "@/lib/mcp/server-types"
import type { McpTransport } from "@/lib/mcp/config"

export type McpPair = { name: string; value: string }
export type McpVisibleSecret = { id: Id<"mcpServerSecrets">; name: string }
export type McpVisibleSecrets = {
  env: McpVisibleSecret[]
  envHeaders: McpVisibleSecret[]
  headers: McpVisibleSecret[]
}

export const MCP_TRANSPORT_OPTIONS: Array<{
  label: string
  value: McpTransport
}> = [
  { label: "STDIO", value: "stdio" },
  { label: "Streamable HTTP", value: "http" },
]

export function mcpServerSubtitle(server: McpServerRecord) {
  if (server.transport === "stdio") {
    return (
      [server.command, ...(server.args ?? [])].filter(Boolean).join(" ") ||
      "stdio server"
    )
  }
  return server.url || "HTTP server"
}

export function cleanMcpStringList(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean)
}

export function cleanMcpPairs(values: McpPair[]) {
  return values
    .map((pair) => ({ name: pair.name.trim(), value: pair.value.trim() }))
    .filter((pair) => pair.name && pair.value)
}

export function visibleMcpSecrets(
  server: McpServerRecord | undefined,
  removeSecretIds: Array<Id<"mcpServerSecrets">>
): McpVisibleSecrets {
  const remaining = (server?.secrets ?? []).filter(
    (secret) => !removeSecretIds.includes(secret.id)
  )
  return {
    env: remaining.filter((secret) => secret.kind === "env"),
    envHeaders: remaining.filter((secret) => secret.kind === "envHttpHeader"),
    headers: remaining.filter((secret) => secret.kind === "httpHeader"),
  }
}
