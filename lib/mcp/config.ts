export type McpToolPolicy = "auto" | "prompt" | "never"
export type McpTransport = "stdio" | "http"

export type McpRuntimeTool = {
  description?: string
  name: string
  policy: McpToolPolicy
  title?: string
}

export type McpRuntimeSecret = {
  name: string
  value: string
}

export type McpRuntimeServer = {
  args?: string[]
  bearerTokenEnvVar?: string
  command?: string
  cwd?: string
  envHttpHeaders?: Array<{ name: string; value: string }>
  envVars?: string[]
  httpHeaders?: Array<{ name: string; value: string }>
  name: string
  secrets?: McpRuntimeSecret[]
  startupTimeoutSec?: number
  toolTimeoutSec?: number
  tools?: McpRuntimeTool[]
  transport: McpTransport
  url?: string
}

const MCP_NAME_RE = /^[A-Za-z0-9_-]+$/

function tomlString(value: string) {
  return JSON.stringify(value)
}

function tomlStringArray(values: string[]) {
  return `[${values.map(tomlString).join(", ")}]`
}

function tomlInlineTable(entries: Array<{ name: string; value: string }>) {
  return `{ ${entries
    .map(
      (entry) =>
        `${tomlBareOrQuotedKey(entry.name)} = ${tomlString(entry.value)}`
    )
    .join(", ")} }`
}

function tomlBareOrQuotedKey(key: string) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key)
}

function assertMcpServerName(name: string) {
  if (!MCP_NAME_RE.test(name)) {
    throw new Error(
      "MCP server name must contain only letters, numbers, underscores, and dashes."
    )
  }
}

export function splitMcpLaunchCommand(value: string) {
  const input = value.trim()
  const parts: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let escaping = false

  for (const char of input) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === "\\") {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current)
        current = ""
      }
      continue
    }

    current += char
  }

  if (escaping) current += "\\"
  if (current) parts.push(current)
  return parts
}

function buildMcpServerConfig(server: McpRuntimeServer) {
  assertMcpServerName(server.name)

  const lines = [
    `[mcp_servers.${tomlBareOrQuotedKey(server.name)}]`,
    "enabled = true",
  ]
  const enabledTools = (server.tools ?? [])
    .filter((tool) => tool.policy !== "never")
    .map((tool) => tool.name)
  const disabledTools = (server.tools ?? [])
    .filter((tool) => tool.policy === "never")
    .map((tool) => tool.name)

  if (server.transport === "stdio") {
    const commandParts = splitMcpLaunchCommand(server.command ?? "")
    const command = commandParts[0]
    const args = [...commandParts.slice(1), ...(server.args ?? [])]
    if (!command) {
      throw new Error(`MCP server ${server.name} is missing a command.`)
    }
    lines.push(`command = ${tomlString(command)}`)
    if (args.length) {
      lines.push(`args = ${tomlStringArray(args)}`)
    }
    if (server.cwd?.trim()) {
      lines.push(`cwd = ${tomlString(server.cwd.trim())}`)
    }
  } else {
    if (!server.url?.trim()) {
      throw new Error(`MCP server ${server.name} is missing a URL.`)
    }
    lines.push(`url = ${tomlString(server.url.trim())}`)
    if (server.bearerTokenEnvVar?.trim()) {
      lines.push(
        `bearer_token_env_var = ${tomlString(server.bearerTokenEnvVar.trim())}`
      )
    }
    if (server.httpHeaders?.length) {
      lines.push(`http_headers = ${tomlInlineTable(server.httpHeaders)}`)
    }
    if (server.envHttpHeaders?.length) {
      lines.push(`env_http_headers = ${tomlInlineTable(server.envHttpHeaders)}`)
    }
  }

  if (server.envVars?.length) {
    lines.push(`env_vars = ${tomlStringArray(server.envVars)}`)
  }
  if (server.startupTimeoutSec) {
    lines.push(`startup_timeout_sec = ${server.startupTimeoutSec}`)
  }
  if (server.toolTimeoutSec) {
    lines.push(`tool_timeout_sec = ${server.toolTimeoutSec}`)
  }
  if (enabledTools.length) {
    lines.push(`enabled_tools = ${tomlStringArray(enabledTools)}`)
  }
  if (disabledTools.length) {
    lines.push(`disabled_tools = ${tomlStringArray(disabledTools)}`)
  }
  lines.push(`default_tools_approval_mode = ${tomlString("prompt")}`)

  if (server.secrets?.length) {
    lines.push("", `[mcp_servers.${tomlBareOrQuotedKey(server.name)}.env]`)
    for (const secret of server.secrets) {
      lines.push(
        `${tomlBareOrQuotedKey(secret.name)} = ${tomlString(secret.value)}`
      )
    }
  }

  for (const tool of server.tools ?? []) {
    if (tool.policy === "never") continue
    lines.push(
      "",
      `[mcp_servers.${tomlBareOrQuotedKey(server.name)}.tools.${tomlBareOrQuotedKey(tool.name)}]`,
      `approval_mode = ${tomlString(tool.policy)}`
    )
  }

  return `${lines.join("\n")}\n`
}

export function buildMcpConfig(servers: McpRuntimeServer[] = []) {
  return servers.map(buildMcpServerConfig).join("\n")
}
