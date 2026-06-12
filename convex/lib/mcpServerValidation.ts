import { splitMcpLaunchCommand, type McpTransport } from "@/lib/mcp/config"
import { cleanEnvNameWithMessage } from "./envNameValidation"

const MCP_SERVER_NAME_RE = /^[A-Za-z0-9_-]+$/
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/
const ENV_NAME_ERROR =
  "Environment variable names must start with a letter or underscore and contain only letters, numbers, and underscores."

export function cleanName(value: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error("MCP server name is required.")
  if (trimmed.length > 80) throw new Error("MCP server name is too long.")
  return trimmed
}

export function cleanServerName(value: string) {
  const trimmed = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)

  if (!trimmed) throw new Error("MCP server name is required.")
  if (!MCP_SERVER_NAME_RE.test(trimmed)) {
    throw new Error(
      "MCP server names can only contain letters, numbers, underscores, and dashes."
    )
  }
  return trimmed
}

export function cleanToolName(value: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error("MCP tool name is required.")
  if (trimmed.length > 160) throw new Error("MCP tool name is too long.")
  if (
    Array.from(trimmed).some((char) => {
      const code = char.charCodeAt(0)
      return code < 32 || code === 127
    })
  ) {
    throw new Error("MCP tool names cannot contain control characters.")
  }
  return trimmed
}

export function cleanOptionalString(value: string | undefined, max: number) {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed.length > max) throw new Error("MCP value is too long.")
  return trimmed
}

export function truncateOptionalString(value: string | undefined, max: number) {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function cleanUrl(value: string | undefined) {
  const trimmed = cleanOptionalString(value, 500)
  if (!trimmed) return undefined

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error("MCP server URL must be a valid URL.")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("MCP server URL must use http or https.")
  }
  return trimmed
}

export function cleanEnvName(name: string) {
  return cleanEnvNameWithMessage(name, ENV_NAME_ERROR)
}

export function cleanHeaderName(name: string) {
  const trimmed = name.trim()
  if (!HEADER_NAME_RE.test(trimmed)) {
    throw new Error("Header names contain unsupported characters.")
  }
  return trimmed
}

function cleanArgs(args: string[] | undefined) {
  return args
    ?.map((arg) => arg.trim())
    .filter(Boolean)
    .slice(0, 40)
}

function cleanEnvVars(envVars: string[] | undefined) {
  return Array.from(new Set((envVars ?? []).map(cleanEnvName))).slice(0, 80)
}

function cleanTimeout(value: number | undefined) {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 1 || value > 600) {
    throw new Error("MCP timeouts must be between 1 and 600 seconds.")
  }
  return Math.floor(value)
}

export function buildCustomServerFields(
  args: {
    args?: string[]
    bearerTokenEnvVar?: string
    command?: string
    cwd?: string
    envVars?: string[]
    name: string
    startupTimeoutSec?: number
    toolTimeoutSec?: number
    transport: McpTransport
    url?: string
  },
  now: number
) {
  const name = cleanName(args.name)
  const serverName = cleanServerName(name)
  const argsList = cleanArgs(args.args)
  const envVars = cleanEnvVars(args.envVars)
  const transport = args.transport
  const commandParts =
    transport === "stdio" ? splitMcpLaunchCommand(args.command ?? "") : []

  if (transport === "stdio" && !commandParts.length) {
    throw new Error("Command is required for STDIO MCP servers.")
  }
  if (transport === "http" && !args.url?.trim()) {
    throw new Error("URL is required for HTTP MCP servers.")
  }

  const fields = {
    args:
      transport === "stdio"
        ? [...commandParts.slice(1), ...(argsList ?? [])]
        : argsList,
    bearerTokenEnvVar:
      transport === "http"
        ? cleanOptionalString(args.bearerTokenEnvVar, 80)
        : undefined,
    command:
      transport === "stdio"
        ? cleanOptionalString(commandParts[0], 500)
        : undefined,
    cwd: transport === "stdio" ? cleanOptionalString(args.cwd, 500) : undefined,
    description: undefined,
    envVars,
    name,
    serverName,
    startupTimeoutSec: cleanTimeout(args.startupTimeoutSec) ?? 20,
    toolTimeoutSec: cleanTimeout(args.toolTimeoutSec) ?? 60,
    transport,
    updatedAt: now,
    url: transport === "http" ? cleanUrl(args.url) : undefined,
  }

  return { fields, serverName }
}
