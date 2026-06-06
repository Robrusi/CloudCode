import { createHash, randomBytes } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import {
  CodexAppServerError,
  type CodexAppServerNotification,
  createCodexAppServerTurnReducer,
} from "./codex-app-server"
import {
  CODEX_APP_SERVER_DAEMON_CLIENT_SCRIPT,
  CODEX_APP_SERVER_DAEMON_SCRIPT,
  CODEX_APP_SERVER_DAEMON_VERSION,
} from "./codex-app-server-daemon-script"
import {
  defaultBranchName,
  defaultBranchNameWithSuffix,
  parseBranchMode,
  shuffledCityBranchNames,
} from "./codex-branch-names"
import {
  codexCliPackageName,
  codexCliVersionOutput,
  desiredCodexCliVersion,
} from "./codex-cli-version"
import {
  daytonaDesktopAgentContext,
  installDaytonaDesktopTools,
  stopDaytonaDesktopAgentRecording,
  type DaytonaDesktopRecordingArtifact,
} from "./daytona-desktop"
import {
  cloudcodeContextAgentContext,
  cloudcodeContextAgentInstructions,
  cloudcodeContextCodexConfig,
  installCloudcodeContextTools,
} from "./daytona-context"
import {
  createDaytonaSandbox,
  daytonaCodexPath,
  daytonaTerminalPath,
  daytonaUserPathEntries,
  defaultDaytonaSnapshot,
  defaultDaytonaSandboxResources,
  ensureDaytonaSandboxStarted,
  getDaytonaSandbox,
  installDaytonaTarWrapper,
  readDaytonaTextFile,
  repoCommandEnv,
  resolveDaytonaPaths,
  runDaytonaCommand,
  shellQuote,
  startDaytonaActivityHeartbeat,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "./daytona-sandbox"
import { runCloudcodeYamlSetup } from "./cloudcode-yaml-setup"
import { cloneGitRepositoryInSandbox } from "./daytona-git"
import {
  CLOUDCODE_LEGACY_PRESET_ENV_PATH,
  withoutCloudcodeEnvLocal,
  writeCloudcodeEnvLocal,
  type SandboxEnvTarget,
  type SandboxPresetEnvVar,
} from "./sandbox-env"
import { cloudcodeYamlAgentContext } from "./cloudcode-yaml"
import {
  configureSandboxGitHubRemote,
  setupSandboxGitHubAuth,
  type SandboxGitHubAuth,
} from "./sandbox-github-auth"

const CODEX_UPDATE_TIMEOUT_MS = 3 * 60 * 1000
const CODEX_APP_SERVER_LOCAL_READY_TIMEOUT_MS = 5_000
const CODEX_APP_SERVER_REQUEST_TIMEOUT_MS = 45_000
const RUNTIME_BOOTSTRAP_REFRESHED = "__CLOUDCODE_RUNTIME_BOOTSTRAP_REFRESHED__"
const RUNTIME_BOOTSTRAP_VERSION = "1"
const PRESET_INSTALL_TIMEOUT_MS = 10 * 60 * 1000
const MISE_CONFIG_FILES = [
  ".mise.toml",
  "mise.toml",
  ".config/mise.toml",
  ".config/mise/config.toml",
]

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh"

export type CodexSpeed = "standard" | "fast"

export type RunCodexLogKind =
  | "setup"
  | "command"
  | "reasoning"
  | "stdout"
  | "stderr"
  | "result"

export type RunCodexLog = {
  detail?: string
  kind: RunCodexLogKind
  message: string
}

export type SandboxPresetInput = {
  cloudcodeYaml?: string
  daytonaSnapshot?: string
  installScript?: string
  mode?: "manual" | "auto"
  name: string
  pathInstallScript?: string
  secrets: SandboxPresetEnvVar[]
}

export type RunCodexInSandboxInput = {
  authJson: string
  baseBranch?: string
  branchMode?: "auto" | "custom" | "base"
  branchName?: string
  codexThreadId?: string
  convexUrl?: string
  githubToken?: string
  githubUserEmail?: string
  githubUserName?: string
  githubUsername?: string
  model?: string
  notesAccessToken?: string
  onContentDelta?: (delta: string) => void | Promise<void>
  onLog?: (log: RunCodexLog) => void | Promise<void>
  previousDiff?: string
  prompt: string
  reasoningEffort?: ReasoningEffort
  resumeContext?: string
  repoUrl: string
  runId?: string
  sandboxId?: string
  sandboxPreset?: SandboxPresetInput
  signal?: AbortSignal
  speed?: CodexSpeed
  threadId?: string
}

export type RunCodexInSandboxResult = {
  branchName: string
  codexThreadId?: string
  desktopRecording?: DaytonaDesktopRecordingArtifact
  diff: string
  exitCode: number
  lastMessage: string
  lastMessageAuthoritative?: boolean
  repoUrl: string
  sandboxId: string
  stderr: string
  status: string
  stdout: string
  updatedAuthJson: string
  recoveredSandbox: boolean
}

function parseModel(model?: string) {
  const normalized = model?.trim()

  if (!normalized) return undefined
  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(normalized)) {
    throw new Error("Model contains unsupported characters.")
  }

  return normalized
}

function parseReasoningEffort(effort?: string): ReasoningEffort | undefined {
  if (
    effort === "none" ||
    effort === "low" ||
    effort === "medium" ||
    effort === "high" ||
    effort === "xhigh"
  ) {
    return effort
  }

  if (effort) {
    throw new Error(
      "reasoningEffort must be none, low, medium, high, or xhigh."
    )
  }

  return undefined
}

function parseSpeed(speed?: string): CodexSpeed {
  if (!speed || speed === "standard") return "standard"
  if (speed === "fast") return speed
  throw new Error("speed must be standard or fast.")
}

function parseRepoUrl(repoUrl: string) {
  const normalized = repoUrl.trim()
  if (!normalized) throw new Error("repoUrl is required.")

  try {
    const url = new URL(normalized)
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("repoUrl must be an http(s) Git URL.")
    }
  } catch {
    throw new Error("repoUrl must be a valid Git URL.")
  }

  return normalized
}

function parseGitRef(value: string | undefined, label: string) {
  const normalized = value?.trim()
  if (!normalized) return undefined

  if (
    normalized.startsWith("-") ||
    normalized.includes("..") ||
    normalized.includes("//") ||
    !/^[a-zA-Z0-9._/-]{1,120}$/.test(normalized)
  ) {
    throw new Error(`${label} contains unsupported characters.`)
  }

  return normalized
}

function parseOpaqueId(value: string | undefined, label: string) {
  const normalized = value?.trim()
  if (!normalized) return undefined

  if (!/^[a-zA-Z0-9._:-]{1,180}$/.test(normalized)) {
    throw new Error(`${label} contains unsupported characters.`)
  }

  return normalized
}

function compactLine(value: string, max = 220) {
  const line = value.replace(/\s+/g, " ").trim()
  return line.length > max ? `${line.slice(0, max - 3)}...` : line
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

function stripAnsi(value: string) {
  let output = ""
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x1b && value[index + 1] === "[") {
      index += 2
      while (index < value.length) {
        const code = value.charCodeAt(index)
        if (code >= 0x40 && code <= 0x7e) break
        index += 1
      }
      continue
    }
    output += value[index] ?? ""
  }
  return output
}

function isBundledBubblewrapWarning(value: string) {
  const normalized = value.toLowerCase()
  return (
    normalized.includes("codex could not find bubblewrap on path") &&
    normalized.includes("bundled bubblewrap")
  )
}

export function codexAppServerStderrLogForLine(
  line: string,
  options: { bundledBubblewrapWarningAlreadyLogged?: boolean } = {}
): RunCodexLog | undefined {
  const clean = stripAnsi(line)
  const trimmed = compactLine(clean)
  if (!trimmed) return undefined

  if (isBundledBubblewrapWarning(clean)) {
    if (options.bundledBubblewrapWarningAlreadyLogged) return undefined
    return {
      kind: "setup",
      message: "Codex using bundled bubblewrap sandbox helper",
    }
  }

  return { kind: "stderr", message: trimmed }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return undefined
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

type CodexAppServerRunResult = {
  codexThreadId: string
  exitCode: number
  lastMessage: string
  stderr: string
  stdout: string
  updatedAuthJson: string
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

type CodexAppServerDaemonPaths = {
  clientPath: string
  scriptPath: string
  sessionId: string
  socketPath: string
  statePath: string
}

type CodexAppServerDaemonEvent =
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
      message: string
      type: "error"
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
      updatedAuthJson: string
    }

type CodexAppServerDaemonHandle = {
  env: Record<string, string>
  envHash: string
  paths: CodexAppServerDaemonPaths
}

function codexAppServerDaemonPaths(
  paths: DaytonaSandboxPaths
): CodexAppServerDaemonPaths {
  const root = `${paths.runtimeHome}/codex-app-server`
  return {
    clientPath: `${root}/cloudcode-codex-daemon-client.mjs`,
    scriptPath: `${root}/cloudcode-codex-daemon.mjs`,
    sessionId: "cloudcode-codex-app-server-daemon",
    socketPath: `${root}/codex-app-server.sock`,
    statePath: `${root}/codex-app-server-daemon.json`,
  }
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

function codexAppServerDaemonEnv({
  gitAuth,
  input,
  paths,
}: {
  gitAuth?: SandboxGitHubAuth | null
  input: RunCodexInSandboxInput
  paths: DaytonaSandboxPaths
}) {
  const daemonPaths = codexAppServerDaemonPaths(paths)
  const baseEnv = {
    ...codexShellEnv(paths, input.sandboxPreset?.secrets, gitAuth?.env),
    CLOUDCODE_APP_SERVER_REQUEST_TIMEOUT_MS: String(
      CODEX_APP_SERVER_REQUEST_TIMEOUT_MS
    ),
    CLOUDCODE_CODEX_LAUNCHER: paths.codexLauncherPath,
    CLOUDCODE_DAEMON_SOCKET: daemonPaths.socketPath,
    CLOUDCODE_DAEMON_STATE: daemonPaths.statePath,
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

function codexAppServerDaemonClientCommand({
  daemonPaths,
  payloadPath,
  paths,
}: {
  daemonPaths: CodexAppServerDaemonPaths
  payloadPath: string
  paths: DaytonaSandboxPaths
}) {
  return `bash -c ${shellQuote(
    [
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
  const type = stringValue(record?.type)
  if (!record || !type) return undefined

  switch (type) {
    case "notification": {
      const notification = objectRecord(record.notification)
      return notification ? { notification, type } : undefined
    }
    case "stderr": {
      const value = stringValue(record.line)
      return value ? { line: value, type } : undefined
    }
    case "setup": {
      const message = stringValue(record.message)
      return message ? { message, type } : undefined
    }
    case "error": {
      const message = stringValue(record.message)
      return message ? { message, type } : undefined
    }
    case "thread": {
      const threadId = stringValue(record.threadId)
      return threadId ? { threadId, type } : undefined
    }
    case "health": {
      const envHash = stringValue(record.envHash) ?? ""
      const version = stringValue(record.version) ?? ""
      return {
        envHash,
        ok: record.ok === true,
        ...(typeof record.pid === "number" ? { pid: record.pid } : {}),
        type,
        version,
      }
    }
    case "result": {
      const status = stringValue(record.status)
      const threadId = stringValue(record.threadId)
      const updatedAuthJson = stringValue(record.updatedAuthJson)
      if (!status || !threadId || !updatedAuthJson) return undefined
      return {
        ...(stringValue(record.finalAssistantText)
          ? { finalAssistantText: stringValue(record.finalAssistantText) }
          : {}),
        status,
        threadId,
        ...(stringValue(record.turnError)
          ? { turnError: stringValue(record.turnError) }
          : {}),
        type,
        updatedAuthJson,
      }
    }
    default:
      return undefined
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

async function requestCodexAppServerDaemon({
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

async function ensureCodexAppServerDaemon({
  gitAuth,
  input,
  paths,
  sandbox,
}: {
  gitAuth?: SandboxGitHubAuth | null
  input: RunCodexInSandboxInput
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
}): Promise<CodexAppServerDaemonHandle> {
  const { daemonPaths, env, envHash } = codexAppServerDaemonEnv({
    gitAuth,
    input,
    paths,
  })
  await writeCodexAppServerDaemonScripts(
    sandbox,
    paths,
    daemonPaths,
    input.signal
  )

  const health = await codexAppServerDaemonHealth({
    daemonPaths,
    gitAuth,
    paths,
    sandbox,
    signal: input.signal,
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
    signal: input.signal,
  })

  await emitLog(input, {
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
      signal: input.signal,
    })
    if (
      lastHealth?.type === "health" &&
      lastHealth.ok &&
      lastHealth.version === CODEX_APP_SERVER_DAEMON_VERSION &&
      lastHealth.envHash === envHash
    ) {
      await emitLog(input, {
        kind: "setup",
        message: "Codex app-server daemon ready",
      })
      return { env, envHash, paths: daemonPaths }
    }
    await wait(250, input.signal)
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

export function appServerThreadParams({
  model,
  paths,
  reasoningEffort,
  speed,
}: {
  model?: string
  paths: DaytonaSandboxPaths
  reasoningEffort?: ReasoningEffort
  speed: CodexSpeed
}) {
  const config = {
    approval_policy: "never",
    sandbox_mode: "danger-full-access",
    ...(reasoningEffort ? { model_reasoning_effort: reasoningEffort } : {}),
    ...(speed === "fast" ? { service_tier: "fast" } : {}),
  }

  return {
    approvalPolicy: "never" as const,
    config,
    cwd: paths.repoPath,
    ephemeral: false,
    ...(model ? { model } : {}),
    sandbox: "danger-full-access" as const,
    serviceName: "cloudcode",
    ...(speed === "fast" ? { serviceTier: "fast" } : {}),
  }
}

function appServerTurnParams({
  model,
  paths,
  prompt,
  reasoningEffort,
  speed,
  threadId,
}: {
  model?: string
  paths: DaytonaSandboxPaths
  prompt: string
  reasoningEffort?: ReasoningEffort
  speed: CodexSpeed
  threadId: string
}) {
  return {
    approvalPolicy: "never" as const,
    cwd: paths.repoPath,
    input: [{ text: prompt, text_elements: [] as [], type: "text" as const }],
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { effort: reasoningEffort } : {}),
    sandboxPolicy: { type: "dangerFullAccess" as const },
    ...(speed === "fast" ? { serviceTier: "fast" } : {}),
    threadId,
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
      stringValue(thread?.id) ??
      stringValue(params?.threadId) ??
      stringValue(turn?.threadId),
    turnId:
      stringValue(turn?.id) ??
      stringValue(params?.turnId) ??
      stringValue(params?.turn_id),
  }
}

function codexAppServerNotificationMatchesActiveRoute({
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

async function runCodexViaAppServer({
  codexThreadIdToResume,
  gitAuth,
  input,
  model,
  paths,
  prompt,
  reasoningEffort,
  sandbox,
  speed,
}: {
  codexThreadIdToResume?: string
  gitAuth?: SandboxGitHubAuth | null
  input: RunCodexInSandboxInput
  model?: string
  paths: DaytonaSandboxPaths
  prompt: string
  reasoningEffort?: ReasoningEffort
  sandbox: Sandbox
  speed: CodexSpeed
}): Promise<CodexAppServerRunResult> {
  let activeThreadId = codexThreadIdToResume
  let activeTurnId: string | undefined
  let daemonResult:
    | Extract<CodexAppServerDaemonEvent, { type: "result" }>
    | undefined
  let daemonError = ""
  let stdout = ""
  let stderr = ""
  let resumeLogged = false
  let bundledBubblewrapWarningLogged = false

  try {
    const daemon = await ensureCodexAppServerDaemon({
      gitAuth,
      input,
      paths,
      sandbox,
    })
    const reducer = createCodexAppServerTurnReducer({
      onContentDelta: input.onContentDelta,
      onLog: input.onLog,
    })
    const threadParams = appServerThreadParams({
      model,
      paths,
      reasoningEffort,
      speed,
    })
    const turnParams = appServerTurnParams({
      model,
      paths,
      prompt,
      reasoningEffort,
      speed,
      threadId: activeThreadId ?? "__cloudcode_pending_thread__",
    })

    const emitDaemonStderr = (line: string) => {
      const log = codexAppServerStderrLogForLine(line, {
        bundledBubblewrapWarningAlreadyLogged: bundledBubblewrapWarningLogged,
      })
      if (!log) return
      if (log.message === "Codex using bundled bubblewrap sandbox helper") {
        bundledBubblewrapWarningLogged = true
      }
      void input.onLog?.(log)
    }

    const interruptDaemonRun = () => {
      void requestCodexAppServerDaemon({
        daemonPaths: daemon.paths,
        gitAuth,
        label: "interrupt",
        paths,
        payload: { type: "interrupt" },
        sandbox,
        timeoutMs: 10_000,
      }).catch(() => undefined)
    }
    input.signal?.addEventListener("abort", interruptDaemonRun, { once: true })
    if (input.signal?.aborted) interruptDaemonRun()

    const daemonResponse = await requestCodexAppServerDaemon({
      daemonPaths: daemon.paths,
      gitAuth,
      label: "run",
      onEvent: (event) => {
        stdout += `${JSON.stringify(event)}\n`
        switch (event.type) {
          case "thread": {
            activeThreadId = event.threadId
            if (codexThreadIdToResume && !resumeLogged) {
              resumeLogged = true
              void emitLog(input, {
                detail: activeThreadId,
                kind: "setup",
                message: "Resumed Codex thread",
              })
            }
            return
          }
          case "notification": {
            const { notification } = event
            if (
              !codexAppServerNotificationMatchesActiveRoute({
                activeThreadId,
                activeTurnId,
                notification,
              })
            ) {
              return
            }

            const route = codexAppServerNotificationRoute(notification)
            if (
              notification.method === "turn/started" &&
              route.turnId &&
              (!activeThreadId ||
                !route.threadId ||
                route.threadId === activeThreadId)
            ) {
              activeTurnId ??= route.turnId
            }

            reducer.handleNotification(notification)
            return
          }
          case "stderr":
            stderr += `${event.line}\n`
            emitDaemonStderr(event.line)
            return
          case "setup":
            if (
              event.message === "Codex using bundled bubblewrap sandbox helper"
            ) {
              if (bundledBubblewrapWarningLogged) return
              bundledBubblewrapWarningLogged = true
            }
            void emitLog(input, { kind: "setup", message: event.message })
            return
          case "error":
            daemonError = event.message
            return
          case "result":
            daemonResult = event
            activeThreadId = event.threadId
            return
        }
      },
      paths,
      payload: {
        authHash: sha256(input.authJson),
        authJson: input.authJson,
        codexThreadIdToResume,
        threadParams,
        turnParams,
        type: "run",
      },
      sandbox,
      signal: input.signal,
    }).finally(() => {
      input.signal?.removeEventListener("abort", interruptDaemonRun)
    })
    const { result } = daemonResponse

    if (result.stderr) {
      stderr += result.stderr
    }
    if (result.exitCode !== 0 && !daemonError) {
      daemonError =
        compactLine(result.stderr || result.stdout) ||
        "Codex app-server daemon client failed."
    }
    if (daemonError) {
      throw new Error(daemonError)
    }
    if (!daemonResult) {
      throw new Error("Codex app-server daemon did not return a turn result.")
    }
    if (!daemonResult.updatedAuthJson) {
      throw new Error("Codex app-server daemon did not return updated auth.")
    }

    if (!activeThreadId) {
      throw new Error("Codex app-server did not return a thread id.")
    }

    const summary = reducer.summary()
    const status =
      summary.status === "inProgress" ? daemonResult.status : summary.status
    const exitCode = status === "completed" ? 0 : 1
    const lastMessage =
      summary.finalAssistantText || daemonResult.finalAssistantText || ""
    const turnError =
      status === "completed"
        ? ""
        : summary.turnError || daemonResult.turnError || stderr

    return {
      codexThreadId: activeThreadId,
      exitCode,
      lastMessage,
      stderr: turnError,
      stdout,
      updatedAuthJson: daemonResult.updatedAuthJson,
    }
  } catch (error) {
    const message =
      error instanceof CodexAppServerError && error.code !== undefined
        ? `${error.message} (${error.code})`
        : error instanceof Error
          ? error.message
          : "Codex app-server run failed."
    if (stdout.trim() || stderr.trim()) {
      throw new Error(
        [message, stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n")
      )
    }
    throw error
  }
}

function createSandboxTarget(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
): SandboxEnvTarget {
  return {
    readTextFile: (path) => readDaytonaTextFile(sandbox, path),
    runCommand: (command, options) =>
      runDaytonaCommand(sandbox, command, {
        cwd: paths.home,
        env: repoCommandEnv(paths),
        signal,
        timeoutMs: options?.timeoutMs,
      }),
    writeTextFile: (path, content) =>
      writeDaytonaTextFile(sandbox, path, content),
  }
}

async function collectRunDiffAndStatus({
  exitCode,
  gitAuth,
  input,
  paths,
  sandbox,
}: {
  exitCode: number
  gitAuth?: SandboxGitHubAuth | null
  input: RunCodexInSandboxInput
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
}) {
  const target = createSandboxTarget(sandbox, paths, input.signal)
  return await withoutCloudcodeEnvLocal(
    target,
    {
      legacyPresetEnvPath: CLOUDCODE_LEGACY_PRESET_ENV_PATH,
      presetEnvPath: paths.presetEnvPath,
      repoPath: paths.repoPath,
    },
    async () => {
      const diff = (
        await runDaytonaCommand(
          sandbox,
          [
            "set -e",
            `base_ref=$(cat ${shellQuote(paths.baseRefPath)} 2>/dev/null || true)`,
            'if [ -z "$base_ref" ]; then',
            `  base_ref=$(git -C ${shellQuote(paths.repoPath)} rev-parse --verify HEAD 2>/dev/null || git -C ${shellQuote(paths.repoPath)} hash-object -t tree /dev/null)`,
            "fi",
            `git -C ${shellQuote(paths.repoPath)} add -N . >/dev/null 2>&1 || true`,
            `git -C ${shellQuote(paths.repoPath)} diff --binary "$base_ref"`,
          ].join("\n"),
          {
            env: repoCommandEnv(paths, gitAuth?.env),
            signal: input.signal,
            timeoutMs: 60_000,
          }
        )
      ).stdout
      const status = await runDaytonaCommand(
        sandbox,
        `git -C ${shellQuote(paths.repoPath)} status --short --branch`,
        {
          env: repoCommandEnv(paths, gitAuth?.env),
          signal: input.signal,
          timeoutMs: 60_000,
        }
      ).then((result) => result.stdout)
      await emitLog(input, {
        kind: "result",
        message:
          exitCode === 0
            ? "Codex run completed"
            : `Codex exited with code ${exitCode}`,
      })

      return { diff, status }
    }
  )
}

function secretExports(secrets: SandboxPresetEnvVar[]) {
  return secrets
    .map((secret) => `export ${secret.name}=${shellQuote(secret.value)}`)
    .join("\n")
}

function presetProfileSnippet(
  paths: DaytonaSandboxPaths,
  preset?: SandboxPresetInput
) {
  return [
    "# Cloudcode runtime environment",
    `export PATH="${daytonaTerminalPath(paths.home)}:$PATH"`,
    `export CODEX_HOME=${shellQuote(paths.codexHome)}`,
    `export MISE_TRUSTED_CONFIG_PATHS=${shellQuote(paths.repoPath)}`,
    "export TAR_OPTIONS='--no-same-owner --no-same-permissions'",
    preset?.secrets.length ? secretExports(preset.secrets) : "",
    `if [ -d ${shellQuote(paths.repoPath)} ]; then cd ${shellQuote(paths.repoPath)}; fi`,
  ]
    .filter(Boolean)
    .join("\n")
}

function runtimeShellProfileSnippet(
  paths: DaytonaSandboxPaths,
  preset?: SandboxPresetInput
) {
  return [
    "# Cloudcode Codex shell environment",
    `export HOME=${shellQuote(paths.runtimeHome)}`,
    `export CODEX_HOME=${shellQuote(paths.codexHome)}`,
    `export MISE_TRUSTED_CONFIG_PATHS=${shellQuote(paths.repoPath)}`,
    `export PATH=${shellQuote(daytonaCodexPath(paths))}`,
    "export TAR_OPTIONS='--no-same-owner --no-same-permissions'",
    preset?.secrets.length ? secretExports(preset.secrets) : "",
  ]
    .filter(Boolean)
    .join("\n")
}

function presetSecretEnv(secrets: SandboxPresetEnvVar[] = []) {
  return Object.fromEntries(
    secrets.map((secret) => [secret.name, secret.value])
  )
}

function codexShellEnv(
  paths: DaytonaSandboxPaths,
  secrets: SandboxPresetEnvVar[] = [],
  extraEnv: Record<string, string> = {}
) {
  return {
    BASH_ENV: "/dev/null",
    CODEX_HOME: paths.codexHome,
    HOME: paths.runtimeHome,
    MISE_TRUSTED_CONFIG_PATHS: paths.repoPath,
    PATH: daytonaCodexPath(paths),
    SHELL: "/bin/bash",
    TAR_OPTIONS: "--no-same-owner --no-same-permissions",
    ...presetSecretEnv(secrets),
    ...extraEnv,
  }
}

function linkSandboxPathToolsCommand(paths: DaytonaSandboxPaths) {
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

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function writeBase64FileCommand(path: string, content: string) {
  const encoded = Buffer.from(content, "utf8").toString("base64")
  return `printf '%s' ${shellQuote(encoded)} | base64 -d > ${shellQuote(path)}`
}

async function sandboxMarkerMatches(
  sandbox: Sandbox,
  markerPath: string,
  expected: string,
  signal?: AbortSignal
) {
  try {
    const result = await runDaytonaCommand(
      sandbox,
      `[ -s ${shellQuote(markerPath)} ] || ([ -f ${shellQuote(
        markerPath
      )} ] && grep -qxF ${shellQuote(expected)} ${shellQuote(markerPath)})`,
      { signal, timeoutMs: 5_000 }
    )
    return result.exitCode === 0
  } catch {
    return false
  }
}

function sandboxIsUnderResourced(sandbox: Sandbox) {
  const desired = defaultDaytonaSandboxResources()
  return (
    sandbox.cpu < desired.cpu ||
    sandbox.memory < desired.memory ||
    sandbox.disk < desired.disk
  )
}

async function emitLog(input: RunCodexInSandboxInput, log: RunCodexLog) {
  await input.onLog?.(log)
}

async function createBranch(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths,
  branchName: string
) {
  await emitLog(input, {
    kind: "command",
    message: `git checkout -b ${branchName}`,
  })
  try {
    await sandbox.git.createBranch(paths.repoPath, branchName)
  } catch {
    const result = await runDaytonaCommand(
      sandbox,
      `git -C ${shellQuote(paths.repoPath)} checkout -b ${shellQuote(branchName)}`,
      { signal: input.signal, timeoutMs: 10_000 }
    )
    if (result.exitCode !== 0) {
      throw new Error(
        compactLine(result.stderr || result.stdout) ||
          "Unable to create branch."
      )
    }
  }
}

async function readSandboxHeadBranch(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths
): Promise<string | null> {
  const result = await runDaytonaCommand(
    sandbox,
    `git -C ${shellQuote(paths.repoPath)} rev-parse --abbrev-ref HEAD`,
    { env: repoCommandEnv(paths), signal: input.signal, timeoutMs: 10_000 }
  )
  const branch = result.stdout.trim()
  return branch && branch !== "HEAD" ? branch : null
}

/**
 * "base" mode keeps the run on the branch the clone/refresh already checked out
 * instead of creating a new one. Returns that branch so commits, pushes, and the
 * diff baseline all target it. Falls back to creating a branch only when HEAD is
 * detached (e.g. the base ref is a tag or commit) so there is something to commit
 * onto.
 */
async function resolveBaseModeBranch(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths,
  baseBranch?: string
): Promise<string> {
  const branch = await readSandboxHeadBranch(sandbox, input, paths)
  if (branch) return branch

  const fallback = baseBranch?.trim() || defaultBranchName()
  await createBranch(sandbox, input, paths, fallback)
  return fallback
}

async function createDefaultBranch(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths,
  branchName: string
) {
  const tryCandidates = async (
    candidates: string[],
    index = 0,
    lastError?: unknown
  ): Promise<string> => {
    const candidate = candidates[index]
    if (!candidate) {
      throw lastError instanceof Error
        ? lastError
        : new Error("Unable to create a default branch.")
    }
    try {
      await createBranch(sandbox, input, paths, candidate)
      return candidate
    } catch (error) {
      return tryCandidates(candidates, index + 1, error)
    }
  }

  try {
    return await tryCandidates(shuffledCityBranchNames(branchName))
  } catch (error) {
    return tryCandidates(
      Array.from({ length: 5 }, () => defaultBranchNameWithSuffix()),
      0,
      error
    )
  }
}

async function connectOrCreateSandbox(input: RunCodexInSandboxInput) {
  const createNewSandbox = () =>
    createDaytonaSandbox({
      envVars: presetSecretEnv(input.sandboxPreset?.secrets),
      labels: {
        "cloudcode-run-id": input.runId,
        "cloudcode-thread-id": input.threadId,
      },
      name: input.sandboxPreset?.name,
      snapshot: input.sandboxPreset?.daytonaSnapshot,
    })
  const desiredSnapshot =
    input.sandboxPreset?.daytonaSnapshot?.trim() || defaultDaytonaSnapshot()

  if (input.sandboxId) {
    try {
      const sandbox = await ensureDaytonaSandboxStarted(
        await getDaytonaSandbox(input.sandboxId)
      )
      const snapshotMismatch =
        desiredSnapshot && sandbox.snapshot !== desiredSnapshot
      const resourceMismatch =
        !desiredSnapshot && sandboxIsUnderResourced(sandbox)
      if (snapshotMismatch || resourceMismatch) {
        await sandbox
          .delete(120)
          .catch(() => sandbox.stop(120, true).catch(() => undefined))
        return {
          createdSandbox: true,
          recoveredSandbox: true,
          sandbox: await createNewSandbox(),
        }
      }

      return {
        createdSandbox: false,
        recoveredSandbox: false,
        sandbox,
      }
    } catch {
      // The DB can outlive an auto-deleted sandbox. Continue in a fresh one.
    }
  }

  return {
    createdSandbox: true,
    recoveredSandbox: Boolean(input.sandboxId),
    sandbox: await createNewSandbox(),
  }
}

async function isCodexLauncherReady(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  try {
    const desiredVersion = desiredCodexCliVersion()
    const versionCheck =
      desiredVersion === "latest"
        ? "true"
        : `[ "$(${shellQuote(paths.codexLauncherPath)} --version 2>/dev/null || true)" = ${shellQuote(
            codexCliVersionOutput(desiredVersion)
          )} ]`
    const result = await runDaytonaCommand(
      sandbox,
      `test -x ${shellQuote(paths.codexLauncherPath)} && ${versionCheck}`,
      { signal, timeoutMs: 10_000 }
    )
    return result.exitCode === 0
  } catch {
    return false
  }
}

async function updateCodexCli(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths
) {
  await emitLog(input, {
    kind: "setup",
    message: "Preparing Codex CLI",
  })

  const desiredVersion = desiredCodexCliVersion()
  const packageName = codexCliPackageName(desiredVersion)
  const versionReady =
    desiredVersion === "latest"
      ? "command -v codex >/dev/null 2>&1"
      : `current="$(codex --version 2>/dev/null || true)"; [ "$current" = ${shellQuote(
          codexCliVersionOutput(desiredVersion)
        )} ]`

  const updateCommand = [
    "set -e",
    `if command -v codex >/dev/null 2>&1 && ${versionReady}; then`,
    "  true",
    "elif command -v npm >/dev/null 2>&1; then",
    `  npm install -g --force ${shellQuote(packageName)}`,
    "elif command -v bun >/dev/null 2>&1; then",
    `  bun install -g ${shellQuote(packageName)}`,
    "else",
    "  echo 'Install Node.js/npm, Bun, or the Codex CLI in the selected Daytona snapshot.' >&2",
    "  exit 1",
    "fi",
    `cat > ${shellQuote(paths.codexLauncherPath)} <<'EOF'`,
    "#!/usr/bin/env bash",
    "set -e",
    'exec codex "$@"',
    "EOF",
    `chmod +x ${shellQuote(paths.codexLauncherPath)}`,
    `${shellQuote(paths.codexLauncherPath)} --version`,
  ].join("\n")

  await emitLog(input, {
    detail:
      desiredVersion === "latest"
        ? "runs once when this app thread initializes its Daytona sandbox"
        : `requires codex-cli ${desiredVersion}`,
    kind: "command",
    message:
      desiredVersion === "latest"
        ? "use preinstalled codex or install @openai/codex when needed"
        : `use preinstalled codex or install ${packageName} when needed`,
  })

  const result = await runDaytonaCommand(sandbox, updateCommand, {
    cwd: paths.home,
    env: {
      HOME: paths.home,
      MISE_TRUSTED_CONFIG_PATHS: paths.repoPath,
      PATH: daytonaTerminalPath(paths.home),
    },
    onStderr: (data) => {
      const trimmed = compactLine(data)
      if (trimmed) void input.onLog?.({ kind: "stderr", message: trimmed })
    },
    onStdout: (data) => {
      const trimmed = compactLine(data)
      if (trimmed) void input.onLog?.({ kind: "stdout", message: trimmed })
    },
    signal: input.signal,
    timeoutMs: CODEX_UPDATE_TIMEOUT_MS,
  })

  if (result.exitCode !== 0) {
    throw new Error(
      [
        "Unable to prepare Codex CLI in the Daytona sandbox.",
        ...[result.stderr, result.stdout].flatMap((value) =>
          value
            .split(/\r?\n/)
            .flatMap((line) => {
              const compact = compactLine(line, 300)
              return compact ? [compact] : []
            })
            .slice(-8)
        ),
      ].join("\n")
    )
  }

  const version =
    result.stdout
      .split(/\r?\n/)
      .flatMap((line) => {
        const trimmed = line.trim()
        return trimmed ? [trimmed] : []
      })
      .at(-1) || "Codex CLI ready"

  await emitLog(input, {
    kind: "setup",
    message: version,
  })
}

async function prepareSandboxRuntime(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths
) {
  const target = createSandboxTarget(sandbox, paths, input.signal)
  const runtimeProfile = runtimeShellProfileSnippet(paths, input.sandboxPreset)
  const presetProfile = presetProfileSnippet(paths, input.sandboxPreset)
  const markerPath = `${paths.codexHome}/runtime-bootstrap.sha256`
  const bootstrapHash = sha256(
    [
      RUNTIME_BOOTSTRAP_VERSION,
      paths.home,
      paths.runtimeHome,
      paths.codexHome,
      paths.repoPath,
      paths.presetEnvPath,
      runtimeProfile,
      presetProfile,
    ].join("\0")
  )

  const bootstrapResult = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `marker_path=${shellQuote(markerPath)}`,
      `bootstrap_hash=${shellQuote(bootstrapHash)}`,
      `if [ -f "$marker_path" ] && grep -qxF -- "$bootstrap_hash" "$marker_path"; then exit 0; fi`,
      `mkdir -p ${shellQuote(paths.home)} ${shellQuote(paths.runtimeHome)} ${shellQuote(paths.codexHome)}`,
      `chmod 700 ${shellQuote(paths.runtimeHome)} ${shellQuote(paths.codexHome)}`,
      'if [ -x /bin/bash ] && command -v usermod >/dev/null 2>&1; then usermod -s /bin/bash "$(id -un)" 2>/dev/null || true; fi',
      'if [ -x /bin/bash ] && command -v chsh >/dev/null 2>&1; then chsh -s /bin/bash "$(id -un)" 2>/dev/null || true; fi',
      "[ -f /etc/profile.d/rvm.sh ] && mv /etc/profile.d/rvm.sh /etc/profile.d/rvm.sh.cloudcode-disabled 2>/dev/null || true",
      linkSandboxPathToolsCommand(paths),
      writeBase64FileCommand(paths.presetEnvPath, presetProfile),
      ...[".bash_profile", ".bash_login", ".profile", ".bashrc"].map((file) =>
        writeBase64FileCommand(`${paths.runtimeHome}/${file}`, runtimeProfile)
      ),
      `chmod 600 ${shellQuote(paths.presetEnvPath)} ${shellQuote(
        `${paths.runtimeHome}/.bash_profile`
      )} ${shellQuote(`${paths.runtimeHome}/.bash_login`)} ${shellQuote(
        `${paths.runtimeHome}/.profile`
      )} ${shellQuote(`${paths.runtimeHome}/.bashrc`)}`,
      `profile_line=${shellQuote(`. ${paths.cloudcodeProfilePath}`)}`,
      `for file in ${shellQuote(`${paths.home}/.bashrc`)} ${shellQuote(`${paths.home}/.profile`)}; do`,
      '  [ -f "$file" ] || continue',
      "  tmp=$(mktemp)",
      '  grep -vxF "$profile_line" "$file" > "$tmp" || true',
      '  cat "$tmp" > "$file"',
      '  rm -f "$tmp"',
      "done",
      `rm -f ${shellQuote(paths.cloudcodeProfilePath)}`,
      `printf '%s\\n' ${shellQuote(RUNTIME_BOOTSTRAP_REFRESHED)}`,
    ].join("\n"),
    { cwd: paths.home, signal: input.signal, timeoutMs: 10_000 }
  )
  if (bootstrapResult.exitCode !== 0) {
    throw new Error(
      compactLine(bootstrapResult.stderr || bootstrapResult.stdout) ||
        "Unable to prepare sandbox runtime."
    )
  }
  if (bootstrapResult.stdout.includes(RUNTIME_BOOTSTRAP_REFRESHED)) {
    await installDaytonaTarWrapper(sandbox, paths)
    await writeDaytonaTextFile(sandbox, markerPath, `${bootstrapHash}\n`)
  }

  if (input.sandboxPreset?.secrets.length) {
    await emitLog(input, {
      kind: "setup",
      message: `Writing ${input.sandboxPreset.secrets.length} preset secret${input.sandboxPreset.secrets.length === 1 ? "" : "s"} to .env.local`,
    })
    await writeCloudcodeEnvLocal(
      target,
      paths.repoPath,
      input.sandboxPreset.secrets
    )
  } else {
    await writeCloudcodeEnvLocal(target, paths.repoPath, [])
  }
}

async function runPathInstallScript(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths,
  gitAuth?: SandboxGitHubAuth | null
) {
  const script = input.sandboxPreset?.pathInstallScript?.trim()
  if (!script) return

  const scriptHash = sha256(script)
  const scriptPath = `${paths.codexHome}/path-install-${scriptHash}.sh`
  const markerPath = `${paths.codexHome}/path-install-${scriptHash}.fingerprint`
  if (
    await sandboxMarkerMatches(sandbox, markerPath, scriptHash, input.signal)
  ) {
    return
  }

  await emitLog(input, {
    kind: "setup",
    message: `Running ${input.sandboxPreset?.name ?? "preset"} PATH setup script`,
  })
  await emitLog(input, {
    kind: "command",
    message: "preset PATH setup script",
  })

  const terminalPath = daytonaTerminalPath(paths.home)
  await writeDaytonaTextFile(
    sandbox,
    scriptPath,
    ["#!/usr/bin/env bash", "set -eo pipefail", script, ""].join("\n")
  )

  const command = [
    "set -eo pipefail",
    `[ -f ${shellQuote(paths.presetEnvPath)} ] && . ${shellQuote(
      paths.presetEnvPath
    )}`,
    `export HOME=${shellQuote(paths.home)}`,
    `export PATH=${shellQuote(terminalPath)}`,
    `mkdir -p ${shellQuote(`${paths.home}/.local/bin`)} ${shellQuote(
      `${paths.home}/.local/share/pnpm`
    )} ${shellQuote(`${paths.home}/.cache/npm`)} ${shellQuote(
      `${paths.home}/.cache/yarn`
    )} ${shellQuote(`${paths.home}/.cache/bun`)} ${shellQuote(
      `${paths.home}/.pnpm-store`
    )}`,
    `export PNPM_HOME=${shellQuote(`${paths.home}/.local/share/pnpm`)}`,
    `export NPM_CONFIG_PREFIX=${shellQuote(`${paths.home}/.npm-global`)}`,
    `export npm_config_prefix=${shellQuote(`${paths.home}/.npm-global`)}`,
    `export NPM_CONFIG_CACHE=${shellQuote(`${paths.home}/.cache/npm`)}`,
    `export npm_config_cache=${shellQuote(`${paths.home}/.cache/npm`)}`,
    `export YARN_CACHE_FOLDER=${shellQuote(`${paths.home}/.cache/yarn`)}`,
    `export BUN_INSTALL=${shellQuote(`${paths.home}/.bun`)}`,
    `export BUN_INSTALL_CACHE_DIR=${shellQuote(`${paths.home}/.cache/bun`)}`,
    `if [ -s ${shellQuote(markerPath)} ] || ([ -f ${shellQuote(markerPath)} ] && grep -qxF ${shellQuote(
      scriptHash
    )} ${shellQuote(markerPath)}); then`,
    "  exit 0",
    "fi",
    `chmod +x ${shellQuote(scriptPath)}`,
    `${shellQuote(scriptPath)}`,
    linkSandboxPathToolsCommand(paths),
    `printf '%s\\n' ${shellQuote(scriptHash)} > ${shellQuote(markerPath)}`,
  ].join("\n")

  const result = await runDaytonaCommand(sandbox, command, {
    cwd: paths.home,
    env: {
      CODEX_HOME: paths.codexHome,
      CI: "1",
      HOME: paths.home,
      MISE_TRUSTED_CONFIG_PATHS: paths.repoPath,
      PATH: terminalPath,
      TAR_OPTIONS: "--no-same-owner --no-same-permissions",
      ...presetSecretEnv(input.sandboxPreset?.secrets),
      ...gitAuth?.env,
    },
    onStderr: (data) => {
      const trimmed = compactLine(data)
      if (trimmed) void input.onLog?.({ kind: "stderr", message: trimmed })
    },
    onStdout: (data) => {
      const trimmed = compactLine(data)
      if (trimmed) void input.onLog?.({ kind: "stdout", message: trimmed })
    },
    signal: input.signal,
    timeoutMs: PRESET_INSTALL_TIMEOUT_MS,
  })

  if (result.exitCode !== 0) {
    const outputLines = [result.stderr, result.stdout].flatMap((value) =>
      value.split(/\r?\n/).flatMap((line) => {
        const compact = compactLine(line, 300)
        return compact ? [compact] : []
      })
    )
    throw new Error(
      [
        `Preset PATH setup script failed with exit code ${result.exitCode}.`,
        ...outputLines.slice(-24),
      ].join("\n")
    )
  }

  await emitLog(input, {
    kind: "setup",
    message: "Preset PATH setup script completed",
  })
}

async function runPresetInstallScript(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths,
  gitAuth?: SandboxGitHubAuth | null
) {
  const script = input.sandboxPreset?.installScript?.trim()
  if (!script) return

  const scriptHash = sha256(script)
  const scriptPath = `${paths.codexHome}/preset-install-${scriptHash}.sh`
  const markerPath = `${paths.codexHome}/preset-install-${scriptHash}.fingerprint`
  if (
    await sandboxMarkerMatches(sandbox, markerPath, scriptHash, input.signal)
  ) {
    return
  }

  await emitLog(input, {
    kind: "setup",
    message: `Running ${input.sandboxPreset?.name ?? "preset"} install script`,
  })
  await emitLog(input, {
    kind: "command",
    message: "preset install script",
  })

  const terminalPath = daytonaTerminalPath(paths.home)
  await writeDaytonaTextFile(
    sandbox,
    scriptPath,
    ["#!/usr/bin/env bash", "set -eo pipefail", script, ""].join("\n")
  )

  const command = [
    "set -eo pipefail",
    `[ -f ${shellQuote(paths.presetEnvPath)} ] && . ${shellQuote(
      paths.presetEnvPath
    )}`,
    `mkdir -p ${shellQuote(`${paths.home}/.cache/npm`)} ${shellQuote(
      `${paths.home}/.cache/yarn`
    )} ${shellQuote(`${paths.home}/.cache/bun`)} ${shellQuote(
      `${paths.home}/.local/share/pnpm`
    )} ${shellQuote(`${paths.home}/.pnpm-store`)}`,
    `export PATH=${shellQuote(terminalPath)}`,
    `export PNPM_HOME=${shellQuote(`${paths.home}/.local/share/pnpm`)}`,
    `export NPM_CONFIG_CACHE=${shellQuote(`${paths.home}/.cache/npm`)}`,
    `export npm_config_cache=${shellQuote(`${paths.home}/.cache/npm`)}`,
    `export NPM_CONFIG_STORE_DIR=${shellQuote(`${paths.home}/.pnpm-store`)}`,
    `export npm_config_store_dir=${shellQuote(`${paths.home}/.pnpm-store`)}`,
    'export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"',
    "export PNPM_CONFIG_CHILD_CONCURRENCY=1",
    "export npm_config_child_concurrency=1",
    "export PNPM_CONFIG_WORKSPACE_CONCURRENCY=1",
    "export npm_config_workspace_concurrency=1",
    "export PNPM_CONFIG_NETWORK_CONCURRENCY=16",
    "export npm_config_network_concurrency=16",
    "export PNPM_CONFIG_VERIFY_STORE_INTEGRITY=false",
    "export npm_config_verify_store_integrity=false",
    `export YARN_CACHE_FOLDER=${shellQuote(`${paths.home}/.cache/yarn`)}`,
    `export BUN_INSTALL_CACHE_DIR=${shellQuote(`${paths.home}/.cache/bun`)}`,
    `command -v pnpm >/dev/null 2>&1 && pnpm config set store-dir ${shellQuote(
      `${paths.home}/.pnpm-store`
    )} --location=user >/dev/null 2>&1 || true`,
    `if [ -s ${shellQuote(markerPath)} ] || ([ -f ${shellQuote(markerPath)} ] && grep -qxF ${shellQuote(
      scriptHash
    )} ${shellQuote(markerPath)}); then`,
    "  exit 0",
    "fi",
    `chmod +x ${shellQuote(scriptPath)}`,
    `${shellQuote(scriptPath)}`,
    `printf '%s\\n' ${shellQuote(scriptHash)} > ${shellQuote(markerPath)}`,
  ].join("\n")
  const runInstall = () =>
    runDaytonaCommand(sandbox, command, {
      cwd: paths.repoPath,
      env: {
        CODEX_HOME: paths.codexHome,
        CI: "1",
        HOME: paths.home,
        MISE_TRUSTED_CONFIG_PATHS: paths.repoPath,
        PATH: terminalPath,
        TAR_OPTIONS: "--no-same-owner --no-same-permissions",
        ...presetSecretEnv(input.sandboxPreset?.secrets),
        ...gitAuth?.env,
      },
      onStderr: (data) => {
        const trimmed = compactLine(data)
        if (trimmed) void input.onLog?.({ kind: "stderr", message: trimmed })
      },
      onStdout: (data) => {
        const trimmed = compactLine(data)
        if (trimmed) void input.onLog?.({ kind: "stdout", message: trimmed })
      },
      signal: input.signal,
      timeoutMs: PRESET_INSTALL_TIMEOUT_MS,
    })

  const result = await runInstall()

  if (result.exitCode !== 0) {
    const outputLines = [result.stderr, result.stdout].flatMap((value) =>
      value.split(/\r?\n/).flatMap((line) => {
        const compact = compactLine(line, 300)
        return compact ? [compact] : []
      })
    )
    throw new Error(
      [
        `Preset install script failed with exit code ${result.exitCode}.`,
        ...outputLines.slice(-24),
      ].join("\n")
    )
  }

  await emitLog(input, {
    kind: "setup",
    message: "Preset install script completed",
  })
}

async function cleanupRunFiles(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  await runDaytonaCommand(
    sandbox,
    `rm -f ${shellQuote(paths.previousDiffPath)} ${shellQuote(paths.lastMessagePath)}`,
    {
      signal,
      timeoutMs: 10_000,
    }
  ).catch(() => undefined)
}

function trustMiseCommand(paths: DaytonaSandboxPaths) {
  const markerPath = `${paths.codexHome}/mise-trust.sha256`
  const configFileArgs = MISE_CONFIG_FILES.map(shellQuote).join(" ")

  return [
    "set -e",
    `marker_path=${shellQuote(markerPath)}`,
    `mkdir -p ${shellQuote(paths.codexHome)}`,
    `export MISE_TRUSTED_CONFIG_PATHS=${shellQuote(paths.repoPath)}`,
    `cd ${shellQuote(paths.repoPath)}`,
    "hash_file() {",
    "  if command -v sha256sum >/dev/null 2>&1; then",
    "    sha256sum \"$1\" | awk '{print $1}'",
    "  elif command -v shasum >/dev/null 2>&1; then",
    "    shasum -a 256 \"$1\" | awk '{print $1}'",
    "  else",
    "    openssl dgst -sha256 \"$1\" | awk '{print $NF}'",
    "  fi",
    "}",
    "hash_stream() {",
    "  if command -v sha256sum >/dev/null 2>&1; then",
    "    sha256sum | awk '{print $1}'",
    "  elif command -v shasum >/dev/null 2>&1; then",
    "    shasum -a 256 | awk '{print $1}'",
    "  else",
    "    openssl dgst -sha256 | awk '{print $NF}'",
    "  fi",
    "}",
    "has_mise_config=0",
    `for file in ${configFileArgs}; do`,
    '  [ ! -f "$file" ] || has_mise_config=1',
    "done",
    'if [ "$has_mise_config" != "1" ]; then',
    "  config_hash=no-mise-config",
    '  if grep -qxF -- "$config_hash" "$marker_path" 2>/dev/null; then exit 0; fi',
    '  printf "%s\\n" "$config_hash" > "$marker_path"',
    "  exit 0",
    "fi",
    "config_hash=$(",
    "  {",
    `    for file in ${configFileArgs}; do`,
    '      [ -f "$file" ] || continue',
    '      printf "%s\\n" "$file"',
    '      hash_file "$file"',
    "    done",
    "  } | hash_stream",
    ")",
    '[ -n "$config_hash" ]',
    'if grep -qxF -- "$config_hash" "$marker_path" 2>/dev/null; then exit 0; fi',
    "if ! command -v mise >/dev/null 2>&1; then",
    "  curl -fsSL https://mise.run | sh",
    '  export PATH="$HOME/.local/bin:$HOME/.mise/bin:$PATH"',
    "fi",
    ...MISE_CONFIG_FILES.map(
      (file) =>
        `[ ! -f ${shellQuote(file)} ] || mise trust -y ${shellQuote(file)}`
    ),
    'printf "%s\\n" "$config_hash" > "$marker_path"',
  ].join("\n")
}

async function trustRepoMiseConfig(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths
) {
  const result = await runDaytonaCommand(sandbox, trustMiseCommand(paths), {
    cwd: paths.home,
    env: {
      HOME: paths.home,
      MISE_TRUSTED_CONFIG_PATHS: paths.repoPath,
      MISE_YES: "1",
      PATH: daytonaTerminalPath(paths.home),
    },
    onStderr: (chunk) => {
      const message = compactLine(chunk)
      if (message) void emitLog(input, { kind: "stderr", message })
    },
    onStdout: (chunk) => {
      const message = compactLine(chunk)
      if (message) void emitLog(input, { kind: "stdout", message })
    },
    signal: input.signal,
    timeoutMs: 2 * 60 * 1000,
  })

  if (result.exitCode !== 0) {
    throw new Error(
      compactLine(result.stderr || result.stdout) ||
        "Unable to trust repo mise config."
    )
  }
}

async function writeBaseRef(sandbox: Sandbox, paths: DaytonaSandboxPaths) {
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -eo pipefail",
      `cd ${shellQuote(paths.repoPath)}`,
      "git rev-parse --verify HEAD 2>/dev/null || git hash-object -t tree /dev/null",
    ].join("\n"),
    {
      timeoutMs: 10_000,
    }
  )
  const baseRef = result.stdout.trim().split(/\s+/)[0]
  if (result.exitCode !== 0 || !baseRef) {
    throw new Error(
      compactLine(result.stderr || result.stdout) ||
        "Unable to record repo base ref."
    )
  }

  await writeDaytonaTextFile(sandbox, paths.baseRefPath, baseRef)
}

async function readRepoState(sandbox: Sandbox, paths: DaytonaSandboxPaths) {
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `if [ ! -d ${shellQuote(`${paths.repoPath}/.git`)} ]; then`,
      "  printf 'missing\\n'",
      "  exit 0",
      "fi",
      "printf 'exists\\n'",
      `git -C ${shellQuote(paths.repoPath)} rev-parse --abbrev-ref HEAD 2>/dev/null || true`,
      `git -C ${shellQuote(paths.repoPath)} remote get-url origin 2>/dev/null || true`,
    ].join("\n"),
    { timeoutMs: 10_000 }
  )
  if (result.exitCode !== 0) return { exists: false, branch: null }

  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim())
  const exists = lines[0] === "exists"
  const branch = exists && lines[1] && lines[1] !== "HEAD" ? lines[1] : null
  const remoteUrl = exists && lines[2] ? lines[2] : null
  return { exists, branch, remoteUrl }
}

async function cloneRepo({
  baseBranch,
  branchName,
  githubToken,
  input,
  requestedBranchName,
  repoUrl,
  sandbox,
  paths,
  gitAuth,
  useBaseBranch,
}: {
  baseBranch?: string
  branchName: string
  gitAuth?: SandboxGitHubAuth | null
  githubToken?: string
  input: RunCodexInSandboxInput
  requestedBranchName?: string
  repoUrl: string
  sandbox: Sandbox
  paths: DaytonaSandboxPaths
  useBaseBranch: boolean
}) {
  const cloneRepository = async () => {
    await emitLog(input, {
      detail: baseBranch ? `branch ${baseBranch}` : undefined,
      kind: "command",
      message: `git clone ${repoUrl}`,
    })
    await cloneGitRepositoryInSandbox({
      branch: baseBranch,
      env: repoCommandEnv(paths, gitAuth?.env),
      password: githubToken,
      path: paths.repoPath,
      repoUrl,
      sandbox,
      signal: input.signal,
      username: githubToken ? "x-access-token" : undefined,
    })
  }

  await cloneRepository()

  if (useBaseBranch) {
    return resolveBaseModeBranch(sandbox, input, paths, baseBranch)
  }
  if (requestedBranchName) {
    await createBranch(sandbox, input, paths, requestedBranchName)
    return requestedBranchName
  }
  return createDefaultBranch(sandbox, input, paths, branchName)
}

async function prepareExistingRepoForFreshRun({
  baseBranch,
  branchName,
  gitAuth,
  input,
  paths,
  requestedBranchName,
  sandbox,
  useBaseBranch,
}: {
  baseBranch?: string
  branchName: string
  gitAuth?: SandboxGitHubAuth | null
  input: RunCodexInSandboxInput
  paths: DaytonaSandboxPaths
  requestedBranchName?: string
  sandbox: Sandbox
  useBaseBranch: boolean
}) {
  await emitLog(input, {
    detail: baseBranch ? `branch ${baseBranch}` : undefined,
    kind: "command",
    message: "refresh prepared repo",
  })

  const refreshCommand = [
    "set -eo pipefail",
    `cd ${shellQuote(paths.repoPath)}`,
    "git fetch origin --prune || true",
    baseBranch
      ? [
          `if git show-ref --verify --quiet ${shellQuote(`refs/remotes/origin/${baseBranch}`)}; then`,
          `  git checkout -B ${shellQuote(baseBranch)} ${shellQuote(`origin/${baseBranch}`)}`,
          "elif git rev-parse --verify HEAD >/dev/null 2>&1; then",
          `  git checkout ${shellQuote(baseBranch)}`,
          "fi",
        ].join("\n")
      : [
          "default_branch=$(git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF}' | head -1)",
          'if [ -n "$default_branch" ] && git show-ref --verify --quiet "refs/remotes/origin/$default_branch"; then',
          '  git checkout -B "$default_branch" "origin/$default_branch"',
          "fi",
        ].join("\n"),
    "if git rev-parse --verify HEAD >/dev/null 2>&1; then",
    "  git reset --hard HEAD",
    "else",
    "  git clean -fd",
    "fi",
  ].join("\n")

  const refreshResult = await runDaytonaCommand(sandbox, refreshCommand, {
    env: repoCommandEnv(paths, gitAuth?.env),
    signal: input.signal,
    timeoutMs: 60_000,
  })
  if (refreshResult.exitCode !== 0) {
    await emitLog(input, {
      kind: "stderr",
      message:
        compactLine(refreshResult.stderr || refreshResult.stdout) ||
        "Unable to refresh prepared repo.",
    })
  }

  if (useBaseBranch) {
    return await resolveBaseModeBranch(sandbox, input, paths, baseBranch)
  }
  if (requestedBranchName) {
    await createBranch(sandbox, input, paths, requestedBranchName)
    return requestedBranchName
  }

  return await createDefaultBranch(sandbox, input, paths, branchName)
}

function isAutoEnvironmentRun(input: RunCodexInSandboxInput) {
  return input.sandboxPreset?.mode === "auto"
}

async function readCloudcodeYamlForLiveSandbox(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths
) {
  if (!isAutoEnvironmentRun(input)) return undefined

  const repoCloudcodeYaml = await readDaytonaTextFile(
    sandbox,
    `${paths.repoPath}/cloudcode.yaml`
  ).catch(() => "")
  if (repoCloudcodeYaml.trim()) {
    return {
      source: "repo" as const,
      yaml: repoCloudcodeYaml,
    }
  }

  const convexCloudcodeYaml = input.sandboxPreset?.cloudcodeYaml?.trim()
  if (!convexCloudcodeYaml) return undefined

  return {
    source: "convex" as const,
    yaml: convexCloudcodeYaml,
  }
}

async function runLiveCloudcodeYamlSetup(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths,
  gitAuth?: SandboxGitHubAuth | null
) {
  const selected = await readCloudcodeYamlForLiveSandbox(sandbox, input, paths)
  if (!selected) return

  const result = await runCloudcodeYamlSetup({
    cloudcodeYaml: selected.yaml,
    emit: (log) => emitLog(input, log),
    env: {
      CI: "1",
      CLOUDCODE_REPO: paths.repoPath,
      HOME: paths.home,
      MISE_TRUSTED_CONFIG_PATHS: paths.repoPath,
      MISE_YES: "1",
      PATH: daytonaTerminalPath(paths.home),
      TAR_OPTIONS: "--no-same-owner --no-same-permissions",
      ...presetSecretEnv(input.sandboxPreset?.secrets),
      ...gitAuth?.env,
    },
    markerPath: `${paths.codexHome}/cloudcode-yaml-setup.sha256`,
    paths,
    sandbox,
    signal: input.signal,
    writeCloudcodeYaml: selected.source === "convex",
  })

  if (result.ran) {
    await emitLog(input, {
      kind: "setup",
      message: "cloudcode.yaml environment setup completed",
    })
  }
}

export async function runCodexInSandbox(input: RunCodexInSandboxInput) {
  const model = parseModel(input.model)
  const reasoningEffort = parseReasoningEffort(input.reasoningEffort)
  const repoUrl = parseRepoUrl(input.repoUrl)
  const baseBranch = parseGitRef(input.baseBranch, "baseBranch")
  const useBaseBranch = parseBranchMode(input.branchMode) === "base"
  const requestedBranchName = useBaseBranch
    ? undefined
    : parseGitRef(input.branchName, "branchName")
  let branchName = requestedBranchName ?? defaultBranchName()
  const githubToken = input.githubToken?.trim()
  const speed = parseSpeed(input.speed)
  const existingCodexThreadId = parseOpaqueId(
    input.codexThreadId,
    "codexThreadId"
  )

  const [, sandboxConnection] = await Promise.all([
    emitLog(input, {
      kind: "setup",
      message: input.sandboxId
        ? "Connecting to Daytona sandbox"
        : input.sandboxPreset?.daytonaSnapshot
          ? "Creating Daytona sandbox from preset snapshot"
          : "Creating Daytona sandbox",
    }),
    connectOrCreateSandbox(input),
  ])
  const { createdSandbox, recoveredSandbox, sandbox } = sandboxConnection
  await emitLog(input, {
    detail: sandbox.id,
    kind: "setup",
    message: recoveredSandbox
      ? "Recovered with a fresh Daytona sandbox"
      : "Daytona sandbox ready",
  })
  const paths = await resolveDaytonaPaths(sandbox)
  let gitAuth: SandboxGitHubAuth | null = null
  let stopDaytonaActivityHeartbeat: (() => void) | undefined
  let checkedDesktopAgentRecording = false
  let emittedDesktopRecordingStopError = false
  let desktopRecording: DaytonaDesktopRecordingArtifact | undefined

  async function stopDesktopAgentRecording() {
    if (checkedDesktopAgentRecording) return

    try {
      const recording = await stopDaytonaDesktopAgentRecording(
        sandbox,
        paths,
        input.signal
      )
      checkedDesktopAgentRecording = true
      if (!recording) return
      desktopRecording = recording

      await emitLog(input, {
        kind: "setup",
        message: "Daytona desktop recording ready",
      })
    } catch (error) {
      if (emittedDesktopRecordingStopError) return
      emittedDesktopRecordingStopError = true
      await emitLog(input, {
        kind: "stderr",
        message:
          error instanceof Error
            ? compactLine(error.message)
            : "Unable to stop Daytona desktop recording.",
      })
    }
  }

  try {
    stopDaytonaActivityHeartbeat = startDaytonaActivityHeartbeat(sandbox)
    gitAuth = await setupSandboxGitHubAuth({
      githubToken,
      githubUserEmail: input.githubUserEmail,
      githubUserName: input.githubUserName,
      githubUsername: input.githubUsername,
      persistCredentials: true,
      paths,
      repoUrl,
      sandbox,
      signal: input.signal,
    })
    const repoStatePromise = readRepoState(sandbox, paths)

    await emitLog(input, {
      detail: sandbox.snapshot,
      kind: "setup",
      message: `Sandbox resources: ${sandbox.cpu} CPU, ${sandbox.memory} GB RAM`,
    })

    const codexThreadIdToResume = existingCodexThreadId
    const taskPrompt = input.prompt
    const sharedNotesEnabled = Boolean(
      input.convexUrl && input.notesAccessToken && input.runId && input.threadId
    )
    const contextBlocks = [
      cloudcodeYamlAgentContext(input.sandboxPreset?.cloudcodeYaml),
      sharedNotesEnabled ? cloudcodeContextAgentContext() : undefined,
      daytonaDesktopAgentContext(),
    ].filter((value): value is string => Boolean(value))
    const promptForTask = (task: string) =>
      contextBlocks.length
        ? [...contextBlocks, "Current user request:", task].join("\n\n")
        : task
    const prompt = promptForTask(taskPrompt)
    const contextConfig = cloudcodeContextCodexConfig({
      convexUrl: input.convexUrl,
      notesAccessToken: input.notesAccessToken,
      paths,
      runId: input.runId,
      threadId: input.threadId,
    })
    const needsCodexSetup =
      recoveredSandbox ||
      !(await isCodexLauncherReady(sandbox, paths, input.signal))

    if (needsCodexSetup) {
      await updateCodexCli(sandbox, input, paths)
    }

    const repoState = await repoStatePromise
    const repoAlreadyExists = repoState.exists
    const configureGitHubRemoteIfNeeded = async () => {
      if (gitAuth?.remoteUrl && repoState.remoteUrl === gitAuth.remoteUrl) {
        return
      }
      await configureSandboxGitHubRemote({
        auth: gitAuth,
        paths,
        sandbox,
        signal: input.signal,
      })
    }
    let preparedFreshRepo = false
    if (!repoAlreadyExists) {
      branchName = await cloneRepo({
        baseBranch,
        branchName,
        gitAuth,
        githubToken,
        input,
        requestedBranchName,
        repoUrl,
        sandbox,
        paths,
        useBaseBranch,
      })
      await configureSandboxGitHubRemote({
        auth: gitAuth,
        paths,
        sandbox,
        signal: input.signal,
      })
      await trustRepoMiseConfig(sandbox, input, paths)
      await writeBaseRef(sandbox, paths)
      preparedFreshRepo = true
    } else {
      await configureGitHubRemoteIfNeeded()
      await trustRepoMiseConfig(sandbox, input, paths)
      const shouldPrepareFreshRepo = createdSandbox
      if (shouldPrepareFreshRepo) {
        branchName = await prepareExistingRepoForFreshRun({
          baseBranch,
          branchName,
          gitAuth,
          input,
          paths,
          requestedBranchName,
          sandbox,
          useBaseBranch,
        })
        await writeBaseRef(sandbox, paths)
        preparedFreshRepo = true
      }
    }
    if (repoAlreadyExists && !preparedFreshRepo) {
      // No branch was created this run, so report the branch HEAD is actually on
      // rather than the generated fallback. Matters most for "base" mode, where
      // the work stays on the base branch across continuations.
      if (repoState.branch) branchName = repoState.branch
    }
    if (preparedFreshRepo && input.previousDiff?.trim()) {
      await Promise.all([
        emitLog(input, {
          kind: "command",
          message: "git apply previous changes",
        }),
        writeDaytonaTextFile(
          sandbox,
          paths.previousDiffPath,
          input.previousDiff
        ),
      ])
      const applyResult = await runDaytonaCommand(
        sandbox,
        `git -C ${shellQuote(
          paths.repoPath
        )} apply --whitespace=nowarn ${shellQuote(paths.previousDiffPath)}`,
        { signal: input.signal, timeoutMs: 60_000 }
      )
      if (applyResult.exitCode !== 0) {
        await emitLog(input, {
          kind: "stderr",
          message:
            compactLine(applyResult.stderr || applyResult.stdout) ||
            "Unable to apply previous diff.",
        })
      }
    }

    await prepareSandboxRuntime(sandbox, input, paths)
      .then(() => runLiveCloudcodeYamlSetup(sandbox, input, paths, gitAuth))
      .then(() =>
        contextConfig
          ? installCloudcodeContextTools(sandbox, paths, input.signal)
          : undefined
      )
      .then(() =>
        installDaytonaDesktopTools(sandbox, paths, input.signal, {
          config: contextConfig,
          instructions: contextConfig
            ? cloudcodeContextAgentInstructions()
            : undefined,
        })
      )
      .then(() => runPathInstallScript(sandbox, input, paths, gitAuth))
      .then(() => runPresetInstallScript(sandbox, input, paths, gitAuth))

    {
      const appServerResult = await runCodexViaAppServer({
        codexThreadIdToResume,
        gitAuth,
        input,
        model,
        paths,
        prompt,
        reasoningEffort,
        sandbox,
        speed,
      })
      await stopDesktopAgentRecording()

      await Promise.all([
        appServerResult.exitCode === 0
          ? Promise.resolve()
          : emitLog(input, {
              detail: String(appServerResult.exitCode),
              kind: "stderr",
              message: `Codex exited with code ${appServerResult.exitCode}`,
            }),
        cleanupRunFiles(sandbox, paths, input.signal),
      ])
      const { updatedAuthJson } = appServerResult

      const { diff, status } = await collectRunDiffAndStatus({
        exitCode: appServerResult.exitCode,
        gitAuth,
        input,
        paths,
        sandbox,
      })

      return {
        branchName,
        codexThreadId: appServerResult.codexThreadId,
        desktopRecording,
        diff,
        exitCode: appServerResult.exitCode,
        lastMessage: appServerResult.lastMessage,
        lastMessageAuthoritative: true,
        repoUrl,
        sandboxId: sandbox.id,
        stderr: appServerResult.stderr,
        status,
        stdout: appServerResult.stdout,
        updatedAuthJson,
        recoveredSandbox,
      } satisfies RunCodexInSandboxResult
    }
  } finally {
    stopDaytonaActivityHeartbeat?.()
    await stopDesktopAgentRecording()
    await Promise.all([
      cleanupRunFiles(sandbox, paths, input.signal),
      gitAuth?.cleanup() ?? Promise.resolve(),
    ])
  }
}
