export type SshConnection = {
  id: string
  accessId: string
  label: string
  sshCommand: string
  expiresAt: number
  createdAt: number
}

export type ExpiresValue = "15" | "60" | "480"

type SshPanelState = {
  connections: SshConnection[] | null
  creating: boolean
  error: string | null
  expires: ExpiresValue
  pendingId: string | null
}

type SshPanelAction =
  | { type: "create-finish" }
  | { type: "create-start" }
  | { type: "load-error"; error: string }
  | { type: "load-success"; connections: SshConnection[] }
  | { type: "rename-local"; id: string; label: string }
  | { type: "remove-finish" }
  | { type: "remove-start"; id: string }
  | { type: "set-error"; error: string | null }
  | { type: "set-expires"; expires: ExpiresValue }

type ParsedSshCommand = {
  user: string
  host: string
  port: string | null
  identityFile: string | null
  options: { key: string; value: string }[]
}

const SSH_TARGET_SEPARATOR = /@/

export const EXPIRES_OPTIONS: { value: ExpiresValue; label: string }[] = [
  { value: "15", label: "15 min" },
  { value: "60", label: "1 hr" },
  { value: "480", label: "8 hr" },
]

export const initialSshPanelState: SshPanelState = {
  connections: null,
  creating: false,
  error: null,
  expires: "60",
  pendingId: null,
}

export function sshPanelReducer(
  state: SshPanelState,
  action: SshPanelAction
): SshPanelState {
  switch (action.type) {
    case "create-finish":
      return { ...state, creating: false }
    case "create-start":
      return { ...state, creating: true, error: null }
    case "load-error":
      return { ...state, connections: [], error: action.error }
    case "load-success":
      return { ...state, connections: action.connections, error: null }
    case "rename-local":
      return {
        ...state,
        connections:
          state.connections?.map((connection) =>
            connection.id === action.id
              ? { ...connection, label: action.label }
              : connection
          ) ?? state.connections,
      }
    case "remove-finish":
      return { ...state, pendingId: null }
    case "remove-start":
      return { ...state, error: null, pendingId: action.id }
    case "set-error":
      return { ...state, error: action.error }
    case "set-expires":
      return { ...state, expires: action.expires }
  }
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "")
  }
  return tokens
}

function parseSshCommand(command: string): ParsedSshCommand | null {
  const tokens = tokenizeCommand(command.trim())
  if (tokens.length === 0 || tokens[0] !== "ssh") return null

  let port: string | null = null
  let identityFile: string | null = null
  const options: { key: string; value: string }[] = []
  let target: string | null = null

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === "-p") {
      port = tokens[++i] ?? null
    } else if (token === "-i") {
      identityFile = tokens[++i] ?? null
    } else if (token === "-o") {
      const raw = tokens[++i] ?? ""
      const eq = raw.indexOf("=")
      if (eq > 0) {
        options.push({ key: raw.slice(0, eq), value: raw.slice(eq + 1) })
      }
    } else if (
      !token.startsWith("-") &&
      SSH_TARGET_SEPARATOR.test(token) &&
      !target
    ) {
      target = token
    }
  }

  if (!target) return null
  const at = target.lastIndexOf("@")
  return {
    user: target.slice(0, at),
    host: target.slice(at + 1),
    port,
    identityFile,
    options,
  }
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
}

function hostAlias(connection: SshConnection) {
  const base =
    slug(connection.label) || `key-${connection.accessId.slice(0, 6)}`
  return `cloudcode-${base}`
}

function buildSshConfig(parsed: ParsedSshCommand, alias: string): string {
  const lines = [
    `Host ${alias}`,
    `  HostName ${parsed.host}`,
    `  User ${parsed.user}`,
  ]
  if (parsed.port) lines.push(`  Port ${parsed.port}`)
  if (parsed.identityFile) lines.push(`  IdentityFile ${parsed.identityFile}`)
  for (const option of parsed.options) {
    lines.push(`  ${option.key} ${option.value}`)
  }
  return lines.join("\n")
}

export function buildSshConfigForConnection(connection: SshConnection) {
  const parsed = parseSshCommand(connection.sshCommand)
  return parsed ? buildSshConfig(parsed, hostAlias(connection)) : null
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return "Expired"
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m left`
  if (minutes > 0) return `${minutes}m ${seconds}s left`
  return `${seconds}s left`
}
