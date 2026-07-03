import type { Id } from "@/convex/_generated/dataModel"
import type { McpToolPolicy, McpTransport } from "@/lib/mcp/config"

export type McpServerRecord = {
  args?: string[]
  bearerTokenEnvVar?: string
  command?: string
  cwd?: string
  description?: string
  enabled: boolean
  envVars?: string[]
  id: Id<"mcpServers">
  name: string
  oauthProvider?: string
  secrets: Array<{
    id: Id<"mcpServerSecrets">
    kind: "env" | "httpHeader" | "envHttpHeader"
    name: string
  }>
  serverName: string
  startupTimeoutSec?: number
  toolTimeoutSec?: number
  tools: Array<{
    description?: string
    id: Id<"mcpServerTools">
    name: string
    policy: McpToolPolicy
    title?: string
  }>
  transport: McpTransport
  url?: string
}
