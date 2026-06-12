import { createHash, randomBytes } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import {
  codexAppServerDaemonClientCommand,
  codexAppServerDaemonCommand,
  codexAppServerDaemonPaths,
  parseCodexAppServerDaemonEventLine,
  type CodexAppServerDaemonEvent,
  type CodexAppServerDaemonPaths,
} from "@/lib/codex/app-server-daemon"
import {
  CODEX_APP_SERVER_DAEMON_CLIENT_SCRIPT,
  CODEX_APP_SERVER_DAEMON_SCRIPT,
  CODEX_APP_SERVER_DAEMON_VERSION,
} from "@/lib/codex/app-server-daemon-script"
import { compactLine } from "@/lib/shared/compact-line"
import {
  repoCommandEnv,
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"
import {
  codexShellEnv,
  userMcpCodexConfig,
  type McpServerInput,
} from "@/lib/daytona/codex-runtime"
import type { SandboxGitHubAuth } from "@/lib/sandbox/github-auth"
import type { SandboxPresetEnvVar } from "@/lib/sandbox/env"

const CODEX_APP_SERVER_LOCAL_READY_TIMEOUT_MS = 5_000
const CODEX_APP_SERVER_REQUEST_TIMEOUT_MS = 45_000

type CodexAppServerDaemonLog = {
  detail?: string
  kind: "command" | "setup"
  message: string
}

export type CodexAppServerDaemonHandle = {
  env: Record<string, string>
  envHash: string
  paths: CodexAppServerDaemonPaths
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function stableHashRecord(value: Record<string, string>) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => {
        if (left < right) return -1
        if (left > right) return 1
        return 0
      })
    )
  )
}

function wait(ms: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms))
  if (signal.aborted) return Promise.reject(new Error("Run was canceled."))

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, ms)

    function done() {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
      resolve()
    }

    function abort() {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
      reject(new Error("Run was canceled."))
    }

    signal.addEventListener("abort", abort, { once: true })
  })
}

function codexAppServerDaemonEnv({
  gitAuth,
  mcpServers,
  paths,
  presetSecrets,
}: {
  gitAuth?: SandboxGitHubAuth | null
  mcpServers?: McpServerInput[]
  paths: DaytonaSandboxPaths
  presetSecrets?: SandboxPresetEnvVar[]
}) {
  const daemonPaths = codexAppServerDaemonPaths(paths)
  const baseEnv = {
    ...codexShellEnv(paths, {
      extraEnv: gitAuth?.env,
      secrets: presetSecrets,
    }),
    CLOUDCODE_APP_SERVER_REQUEST_TIMEOUT_MS: String(
      CODEX_APP_SERVER_REQUEST_TIMEOUT_MS
    ),
    CLOUDCODE_CODEX_LAUNCHER: paths.codexLauncherPath,
    CLOUDCODE_DAEMON_SOCKET: daemonPaths.socketPath,
    CLOUDCODE_DAEMON_STATE: daemonPaths.statePath,
    CLOUDCODE_MCP_CONFIG_HASH: sha256(userMcpCodexConfig(mcpServers)),
    CLOUDCODE_REPO_PATH: paths.repoPath,
  }
  const envHash = sha256(
    [
      CODEX_APP_SERVER_DAEMON_VERSION,
      sha256(CODEX_APP_SERVER_DAEMON_SCRIPT),
      sha256(CODEX_APP_SERVER_DAEMON_CLIENT_SCRIPT),
      stableHashRecord(baseEnv),
    ].join("\0")
  )

  return {
    daemonPaths,
    env: {
      ...baseEnv,
      CLOUDCODE_DAEMON_ENV_HASH: envHash,
    },
    envHash,
  }
}

function codexAppServerDaemonRequestPath(
  paths: DaytonaSandboxPaths,
  label: string
) {
  return `${paths.runtimeHome}/codex-app-server/request-${label}-${Date.now()}-${randomBytes(4).toString("hex")}.json`
}

async function writeCodexAppServerDaemonScripts(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  daemonPaths: CodexAppServerDaemonPaths,
  signal?: AbortSignal
) {
  const mkdir = await runDaytonaCommand(
    sandbox,
    `mkdir -p ${shellQuote(`${paths.runtimeHome}/codex-app-server`)}`,
    { signal, timeoutMs: 10_000 }
  )
  if (mkdir.exitCode !== 0) {
    throw new Error(
      compactLine(mkdir.stderr || mkdir.stdout) ||
        "Unable to create Codex app-server daemon directory."
    )
  }

  await Promise.all([
    writeDaytonaTextFile(
      sandbox,
      daemonPaths.scriptPath,
      CODEX_APP_SERVER_DAEMON_SCRIPT
    ),
    writeDaytonaTextFile(
      sandbox,
      daemonPaths.clientPath,
      CODEX_APP_SERVER_DAEMON_CLIENT_SCRIPT
    ),
  ])

  const chmod = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `chmod 700 ${shellQuote(`${paths.runtimeHome}/codex-app-server`)}`,
      `chmod 600 ${shellQuote(daemonPaths.scriptPath)} ${shellQuote(
        daemonPaths.clientPath
      )}`,
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  )
  if (chmod.exitCode !== 0) {
    throw new Error(
      compactLine(chmod.stderr || chmod.stdout) ||
        "Unable to install Codex app-server daemon scripts."
    )
  }
}

export async function requestCodexAppServerDaemon({
  daemonPaths,
  gitAuth,
  label,
  onEvent,
  paths,
  payload,
  sandbox,
  signal,
  timeoutMs,
}: {
  daemonPaths: CodexAppServerDaemonPaths
  gitAuth?: SandboxGitHubAuth | null
  label: string
  onEvent?: (event: CodexAppServerDaemonEvent) => void | Promise<void>
  paths: DaytonaSandboxPaths
  payload: Record<string, unknown>
  sandbox: Sandbox
  signal?: AbortSignal
  timeoutMs?: number
}) {
  const payloadPath = codexAppServerDaemonRequestPath(paths, label)
  await writeDaytonaTextFile(sandbox, payloadPath, JSON.stringify(payload))

  let buffer = ""
  const events: CodexAppServerDaemonEvent[] = []
  const emitLine = (line: string) => {
    const event = parseCodexAppServerDaemonEventLine(line)
    if (!event) return
    events.push(event)
    void onEvent?.(event)
  }
  const flush = () => {
    if (buffer.trim()) emitLine(buffer)
    buffer = ""
  }

  try {
    const result = await runDaytonaCommand(
      sandbox,
      codexAppServerDaemonClientCommand({ daemonPaths, paths, payloadPath }),
      {
        env: repoCommandEnv(paths, gitAuth?.env),
        onStdout: (chunk) => {
          buffer += chunk
          const lines = buffer.split(/\r?\n/)
          buffer = lines.pop() ?? ""
          for (const line of lines) emitLine(line)
        },
        signal,
        timeoutMs,
      }
    )
    flush()
    return { events, result }
  } finally {
    await runDaytonaCommand(sandbox, `rm -f ${shellQuote(payloadPath)}`, {
      signal,
      timeoutMs: 10_000,
    }).catch(() => undefined)
  }
}

async function codexAppServerDaemonHealth({
  daemonPaths,
  gitAuth,
  paths,
  sandbox,
  signal,
}: {
  daemonPaths: CodexAppServerDaemonPaths
  gitAuth?: SandboxGitHubAuth | null
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
  signal?: AbortSignal
}) {
  const { events, result } = await requestCodexAppServerDaemon({
    daemonPaths,
    gitAuth,
    label: "health",
    paths,
    payload: { type: "health" },
    sandbox,
    signal,
    timeoutMs: CODEX_APP_SERVER_REQUEST_TIMEOUT_MS,
  }).catch(() => ({ events: [], result: undefined }))

  if (!result || result.exitCode !== 0) return undefined
  return events.find((event) => event.type === "health")
}

async function stopCodexAppServerDaemon({
  daemonPaths,
  gitAuth,
  paths,
  sandbox,
  signal,
}: {
  daemonPaths: CodexAppServerDaemonPaths
  gitAuth?: SandboxGitHubAuth | null
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
  signal?: AbortSignal
}) {
  await requestCodexAppServerDaemon({
    daemonPaths,
    gitAuth,
    label: "stop",
    paths,
    payload: { type: "stop" },
    sandbox,
    signal,
    timeoutMs: 5_000,
  }).catch(() => undefined)
  await sandbox.process
    .deleteSession(daemonPaths.sessionId)
    .catch(() => undefined)
  await runDaytonaCommand(
    sandbox,
    `rm -f ${shellQuote(daemonPaths.socketPath)} ${shellQuote(
      daemonPaths.statePath
    )}`,
    { signal, timeoutMs: 10_000 }
  ).catch(() => undefined)
}

export async function ensureCodexAppServerDaemon({
  gitAuth,
  mcpServers,
  onLog,
  paths,
  presetSecrets,
  sandbox,
  signal,
}: {
  gitAuth?: SandboxGitHubAuth | null
  mcpServers?: McpServerInput[]
  onLog?: (log: CodexAppServerDaemonLog) => void | Promise<void>
  paths: DaytonaSandboxPaths
  presetSecrets?: SandboxPresetEnvVar[]
  sandbox: Sandbox
  signal?: AbortSignal
}): Promise<CodexAppServerDaemonHandle> {
  const { daemonPaths, env, envHash } = codexAppServerDaemonEnv({
    gitAuth,
    mcpServers,
    paths,
    presetSecrets,
  })
  await writeCodexAppServerDaemonScripts(sandbox, paths, daemonPaths, signal)

  const health = await codexAppServerDaemonHealth({
    daemonPaths,
    gitAuth,
    paths,
    sandbox,
    signal,
  })
  if (
    health?.type === "health" &&
    health.ok &&
    health.version === CODEX_APP_SERVER_DAEMON_VERSION &&
    health.envHash === envHash
  ) {
    return { env, envHash, paths: daemonPaths }
  }

  await stopCodexAppServerDaemon({
    daemonPaths,
    gitAuth,
    paths,
    sandbox,
    signal,
  })

  await onLog?.({
    detail: "daemon",
    kind: "command",
    message: "codex app-server",
  })

  await sandbox.process.createSession(daemonPaths.sessionId)
  let commandId = ""
  try {
    const started = await sandbox.process.executeSessionCommand(
      daemonPaths.sessionId,
      {
        command: codexAppServerDaemonCommand({ daemonPaths, env, paths }),
        runAsync: true,
        suppressInputEcho: true,
      },
      Math.ceil(CODEX_APP_SERVER_LOCAL_READY_TIMEOUT_MS / 1000)
    )
    commandId = started.cmdId
    if (!commandId) {
      throw new Error(
        "Codex app-server daemon did not return a Daytona command id."
      )
    }
  } catch (error) {
    await sandbox.process
      .deleteSession(daemonPaths.sessionId)
      .catch(() => undefined)
    throw error
  }

  const deadline = Date.now() + CODEX_APP_SERVER_REQUEST_TIMEOUT_MS
  let lastHealth: CodexAppServerDaemonEvent | undefined
  while (Date.now() < deadline) {
    lastHealth = await codexAppServerDaemonHealth({
      daemonPaths,
      gitAuth,
      paths,
      sandbox,
      signal,
    })
    if (
      lastHealth?.type === "health" &&
      lastHealth.ok &&
      lastHealth.version === CODEX_APP_SERVER_DAEMON_VERSION &&
      lastHealth.envHash === envHash
    ) {
      await onLog?.({
        kind: "setup",
        message: "Codex app-server daemon ready",
      })
      return { env, envHash, paths: daemonPaths }
    }
    await wait(250, signal)
  }

  const logs = await sandbox.process
    .getSessionCommandLogs(daemonPaths.sessionId, commandId)
    .catch(() => undefined)
  throw new Error(
    [
      "Codex app-server daemon did not become ready.",
      compactLine(logs?.stderr || logs?.stdout || logs?.output || ""),
      lastHealth ? JSON.stringify(lastHealth) : "",
    ]
      .filter(Boolean)
      .join("\n")
  )
}
