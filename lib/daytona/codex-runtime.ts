import {
  daytonaCodexPath,
  daytonaTerminalPath,
  daytonaUserPathEntries,
  miseTrustedConfigPaths,
  shellQuote,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"
import { buildMcpConfig, type McpRuntimeServer } from "@/lib/mcp/config"
import type { SandboxPresetEnvVar } from "@/lib/sandbox/env"

export type McpServerInput = {
  args?: string[]
  bearerTokenEnvVar?: string
  command?: string
  cwd?: string
  envVars?: string[]
  name: string
  secrets: Array<{
    kind: "env" | "httpHeader" | "envHttpHeader"
    name: string
    value: string
  }>
  startupTimeoutSec?: number
  toolTimeoutSec?: number
  tools: Array<{
    description?: string
    name: string
    policy: "auto" | "prompt" | "never"
    title?: string
  }>
  transport: "stdio" | "http"
  url?: string
}

type SandboxPresetRuntimeInput = {
  secrets: SandboxPresetEnvVar[]
}

function secretExports(secrets: SandboxPresetEnvVar[]) {
  return secrets
    .map((secret) => `export ${secret.name}=${shellQuote(secret.value)}`)
    .join("\n")
}

export function presetProfileSnippet(
  paths: DaytonaSandboxPaths,
  preset?: SandboxPresetRuntimeInput
) {
  return [
    "# Cloudcode runtime environment",
    `export PATH="${daytonaTerminalPath(paths.home)}:$PATH"`,
    `export CODEX_HOME=${shellQuote(paths.codexHome)}`,
    `export MISE_TRUSTED_CONFIG_PATHS=${shellQuote(miseTrustedConfigPaths(paths))}`,
    "export TAR_OPTIONS='--no-same-owner --no-same-permissions'",
    preset?.secrets.length ? secretExports(preset.secrets) : "",
    `if [ -d ${shellQuote(paths.repoPath)} ]; then cd ${shellQuote(paths.repoPath)}; fi`,
  ]
    .filter(Boolean)
    .join("\n")
}

export function runtimeShellProfileSnippet(
  paths: DaytonaSandboxPaths,
  preset?: SandboxPresetRuntimeInput
) {
  return [
    "# Cloudcode Codex shell environment",
    `export HOME=${shellQuote(paths.runtimeHome)}`,
    `export CODEX_HOME=${shellQuote(paths.codexHome)}`,
    `export MISE_TRUSTED_CONFIG_PATHS=${shellQuote(miseTrustedConfigPaths(paths))}`,
    `export PATH=${shellQuote(daytonaCodexPath(paths))}`,
    "export TAR_OPTIONS='--no-same-owner --no-same-permissions'",
    preset?.secrets.length ? secretExports(preset.secrets) : "",
  ]
    .filter(Boolean)
    .join("\n")
}

export function presetSecretEnv(secrets: SandboxPresetEnvVar[] = []) {
  return Object.fromEntries(
    secrets.map((secret) => [secret.name, secret.value])
  )
}

export function codexShellEnv(
  paths: DaytonaSandboxPaths,
  {
    extraEnv = {},
    includeTarOptions = true,
    secrets = [],
  }: {
    extraEnv?: Record<string, string>
    includeTarOptions?: boolean
    secrets?: SandboxPresetEnvVar[]
  } = {}
) {
  return {
    BASH_ENV: "/dev/null",
    CODEX_HOME: paths.codexHome,
    HOME: paths.runtimeHome,
    MISE_TRUSTED_CONFIG_PATHS: miseTrustedConfigPaths(paths),
    PATH: daytonaCodexPath(paths),
    SHELL: "/bin/bash",
    ...(includeTarOptions
      ? { TAR_OPTIONS: "--no-same-owner --no-same-permissions" }
      : {}),
    ...presetSecretEnv(secrets),
    ...extraEnv,
  }
}

export function sandboxInstallEnv(
  paths: DaytonaSandboxPaths,
  {
    extraEnv = {},
    overrides = {},
    secrets = [],
  }: {
    extraEnv?: Record<string, string>
    overrides?: Record<string, string>
    secrets?: SandboxPresetEnvVar[]
  } = {}
) {
  return {
    CODEX_HOME: paths.codexHome,
    CI: "1",
    HOME: paths.home,
    MISE_TRUSTED_CONFIG_PATHS: miseTrustedConfigPaths(paths),
    PATH: daytonaTerminalPath(paths.home),
    TAR_OPTIONS: "--no-same-owner --no-same-permissions",
    ...overrides,
    ...presetSecretEnv(secrets),
    ...extraEnv,
  }
}

function runtimeMcpServers(servers: McpServerInput[] = []): McpRuntimeServer[] {
  return servers.map((server) => ({
    ...server,
    envHttpHeaders: server.secrets
      .filter((secret) => secret.kind === "envHttpHeader")
      .map((secret) => ({ name: secret.name, value: secret.value })),
    httpHeaders: server.secrets
      .filter((secret) => secret.kind === "httpHeader")
      .map((secret) => ({ name: secret.name, value: secret.value })),
    secrets: server.secrets
      .filter((secret) => secret.kind === "env")
      .map((secret) => ({ name: secret.name, value: secret.value })),
  }))
}

export function userMcpCodexConfig(servers: McpServerInput[] | undefined) {
  return buildMcpConfig(runtimeMcpServers(servers))
}

function isExternalGitHubMcpServer(server: McpServerInput) {
  const identity = [
    server.name,
    server.command,
    server.url,
    server.bearerTokenEnvVar,
    ...(server.args ?? []),
    ...(server.envVars ?? []),
    ...server.secrets.map((secret) => secret.name),
  ]
    .filter(Boolean)
    .join("\n")

  return (
    /github/i.test(identity) || /(^|[^a-z0-9])gh([^a-z0-9]|$)/i.test(identity)
  )
}

export function withoutExternalGitHubMcpServers(
  servers: McpServerInput[] | undefined
) {
  if (!servers?.length) return servers

  const filtered = servers.filter(
    (server) => !isExternalGitHubMcpServer(server)
  )
  return filtered.length === servers.length ? servers : filtered
}

export function linkSandboxPathToolsCommand(paths: DaytonaSandboxPaths) {
  const dirs = [
    ...daytonaUserPathEntries(paths.home),
    ...daytonaUserPathEntries(paths.runtimeHome),
  ]

  return [
    `for dir in ${dirs.map(shellQuote).join(" ")}; do`,
    '  [ -d "$dir" ] || continue',
    '  for bin in "$dir"/*; do',
    '    [ -e "$bin" ] || continue',
    '    [ -f "$bin" ] || [ -L "$bin" ] || continue',
    '    [ -x "$bin" ] || continue',
    '    ln -sf "$bin" "/usr/local/bin/$(basename "$bin")" 2>/dev/null || true',
    "  done",
    "done",
  ].join("\n")
}

export function writeBase64FileCommand(path: string, content: string) {
  const encoded = Buffer.from(content, "utf8").toString("base64")
  return `printf '%s' ${shellQuote(encoded)} | base64 -d > ${shellQuote(path)}`
}
