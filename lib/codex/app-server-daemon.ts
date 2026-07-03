import type { CodexAppServerNotification } from "@/lib/codex/app-server"
import {
  daytonaTerminalPath,
  shellQuote,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"
import { objectRecord, rawStringValue } from "@/lib/shared/unknown-values"

export type CodexAppServerDaemonPaths = {
  clientPath: string
  scriptPath: string
  scriptsMarkerPath: string
  sessionId: string
  socketPath: string
  statePath: string
}

// Emitted as error-event messages when a run request cannot be served by the
// daemon as-is: the on-disk scripts predate the client command's fingerprint,
// or the daemon process runs with a stale environment. Both mean "restart the
// daemon and retry", never "the turn failed".
export const CODEX_APP_SERVER_DAEMON_SCRIPTS_STALE =
  "__cloudcode_daemon_scripts_stale__"
export const CODEX_APP_SERVER_DAEMON_ENV_STALE =
  "__cloudcode_daemon_env_stale__"

export function isCodexAppServerDaemonStaleError(
  event: CodexAppServerDaemonEvent
) {
  return (
    event.type === "error" &&
    (event.message === CODEX_APP_SERVER_DAEMON_SCRIPTS_STALE ||
      event.message === CODEX_APP_SERVER_DAEMON_ENV_STALE)
  )
}

export type CodexAppServerDaemonEvent =
  | {
      notification: CodexAppServerNotification
      type: "notification"
    }
  | {
      line: string
      type: "stderr"
    }
  | {
      message: string
      type: "setup"
    }
  | {
      status: unknown
      type: "mcpStatus"
    }
  | {
      message: string
      type: "error"
    }
  | {
      previousAccountId?: string
      requestId: string
      responsePath: string
      type: "authRefreshRequest"
    }
  | {
      threadId: string
      type: "thread"
    }
  | {
      envHash: string
      ok: boolean
      pid?: number
      type: "health"
      version: string
    }
  | {
      finalAssistantText?: string
      status: string
      threadId: string
      turnError?: string
      type: "result"
    }

export function codexAppServerStdioCommand({
  env,
  paths,
}: {
  env: Record<string, string>
  paths: DaytonaSandboxPaths
}) {
  const envExports = Object.entries(env)
    .filter(([name, value]) => validShellEnvName(name) && value !== undefined)
    .map(([name, value]) => `export ${name}=${shellQuote(value)}`)

  return `bash -c ${shellQuote(
    [
      `[ -f ${shellQuote(paths.presetEnvPath)} ] && . ${shellQuote(
        paths.presetEnvPath
      )}`,
      ...envExports,
      `cd ${shellQuote(paths.repoPath)}`,
      `exec ${shellQuote(paths.codexLauncherPath)} app-server`,
    ].join("\n")
  )}`
}

function validShellEnvName(name: string) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
}

export function codexAppServerDaemonPaths(
  paths: DaytonaSandboxPaths
): CodexAppServerDaemonPaths {
  const root = `${paths.runtimeHome}/codex-app-server`
  return {
    clientPath: `${root}/cloudcode-codex-daemon-client.mjs`,
    scriptPath: `${root}/cloudcode-codex-daemon.mjs`,
    scriptsMarkerPath: `${root}/scripts.sha256`,
    sessionId: "cloudcode-codex-app-server-daemon",
    socketPath: `${root}/codex-app-server.sock`,
    statePath: `${root}/codex-app-server-daemon.json`,
  }
}

export function codexAppServerDaemonCommand({
  daemonPaths,
  env,
  paths,
}: {
  daemonPaths: CodexAppServerDaemonPaths
  env: Record<string, string>
  paths: DaytonaSandboxPaths
}) {
  const envExports = Object.entries(env)
    .filter(([name, value]) => validShellEnvName(name) && value !== undefined)
    .map(([name, value]) => `export ${name}=${shellQuote(value)}`)

  return `bash -c ${shellQuote(
    [
      `[ -f ${shellQuote(paths.presetEnvPath)} ] && . ${shellQuote(
        paths.presetEnvPath
      )}`,
      ...envExports,
      `cd ${shellQuote(paths.repoPath)}`,
      `exec node ${shellQuote(daemonPaths.scriptPath)}`,
    ].join("\n")
  )}`
}

export function codexAppServerDaemonClientCommand({
  daemonPaths,
  payloadPath,
  paths,
  scriptsFingerprint,
}: {
  daemonPaths: CodexAppServerDaemonPaths
  payloadPath: string
  paths: DaytonaSandboxPaths
  scriptsFingerprint?: string
}) {
  // The fingerprint preamble lets a request self-detect stale daemon scripts
  // without a separate marker-check roundtrip; exit 0 keeps it distinguishable
  // from real client failures — the stale error event carries the signal.
  const staleEvent = JSON.stringify({
    message: CODEX_APP_SERVER_DAEMON_SCRIPTS_STALE,
    type: "error",
  })
  return `bash -c ${shellQuote(
    [
      ...(scriptsFingerprint
        ? [
            `if ! grep -qxF -- ${shellQuote(scriptsFingerprint)} ${shellQuote(
              daemonPaths.scriptsMarkerPath
            )} 2>/dev/null; then`,
            `  printf '%s\\n' ${shellQuote(staleEvent)}`,
            "  exit 0",
            "fi",
          ]
        : []),
      `export CLOUDCODE_DAEMON_SOCKET=${shellQuote(daemonPaths.socketPath)}`,
      `export PATH=${shellQuote(daytonaTerminalPath(paths.home))}:$PATH`,
      `cd ${shellQuote(paths.repoPath)}`,
      `exec node ${shellQuote(daemonPaths.clientPath)} ${shellQuote(
        payloadPath
      )}`,
    ].join("\n")
  )}`
}

export function parseCodexAppServerDaemonEventLine(
  line: string
): CodexAppServerDaemonEvent | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }

  const record = objectRecord(parsed)
  const type = rawStringValue(record?.type)
  if (!record || !type) return undefined

  switch (type) {
    case "notification": {
      const notification = objectRecord(record.notification)
      return notification ? { notification, type } : undefined
    }
    case "stderr": {
      const value = rawStringValue(record.line)
      return value ? { line: value, type } : undefined
    }
    case "setup": {
      const message = rawStringValue(record.message)
      return message ? { message, type } : undefined
    }
    case "mcpStatus": {
      return { status: record.status, type }
    }
    case "error": {
      const message = rawStringValue(record.message)
      return message ? { message, type } : undefined
    }
    case "authRefreshRequest": {
      const requestId = rawStringValue(record.requestId)
      const responsePath = rawStringValue(record.responsePath)
      if (!requestId || !responsePath) return undefined
      const previousAccountId = rawStringValue(record.previousAccountId)
      return {
        ...(previousAccountId ? { previousAccountId } : {}),
        requestId,
        responsePath,
        type,
      }
    }
    case "thread": {
      const threadId = rawStringValue(record.threadId)
      return threadId ? { threadId, type } : undefined
    }
    case "health": {
      const envHash = rawStringValue(record.envHash) ?? ""
      const version = rawStringValue(record.version) ?? ""
      return {
        envHash,
        ok: record.ok === true,
        ...(typeof record.pid === "number" ? { pid: record.pid } : {}),
        type,
        version,
      }
    }
    case "result": {
      const status = rawStringValue(record.status)
      const threadId = rawStringValue(record.threadId)
      if (!status || !threadId) return undefined
      const finalAssistantText = rawStringValue(record.finalAssistantText)
      const turnError = rawStringValue(record.turnError)
      return {
        ...(finalAssistantText ? { finalAssistantText } : {}),
        status,
        threadId,
        ...(turnError ? { turnError } : {}),
        type,
      }
    }
    default:
      return undefined
  }
}

export function codexAppServerNotificationRoute(
  notification: CodexAppServerNotification
) {
  const params = objectRecord(notification.params)
  const thread = objectRecord(params?.thread)
  const turn = objectRecord(params?.turn)

  return {
    threadId:
      rawStringValue(thread?.id) ??
      rawStringValue(params?.threadId) ??
      rawStringValue(turn?.threadId),
    turnId:
      rawStringValue(turn?.id) ??
      rawStringValue(params?.turnId) ??
      rawStringValue(params?.turn_id),
  }
}

export function codexAppServerNotificationMatchesActiveRoute({
  activeThreadId,
  activeTurnId,
  notification,
}: {
  activeThreadId: string | undefined
  activeTurnId: string | undefined
  notification: CodexAppServerNotification
}) {
  const route = codexAppServerNotificationRoute(notification)
  if (activeThreadId && route.threadId && route.threadId !== activeThreadId) {
    return false
  }
  if (activeTurnId && route.turnId && route.turnId !== activeTurnId) {
    return false
  }

  return true
}
