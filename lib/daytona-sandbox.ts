import { randomUUID } from "node:crypto"

import { Daytona, type Sandbox } from "@daytona/sdk"

export const DAYTONA_TERMINAL_PORT = 22222
export const DEFAULT_DAYTONA_HOME =
  process.env.DAYTONA_SANDBOX_HOME?.trim() || "/home/daytona"
export const DEFAULT_DAYTONA_REPO_PATH =
  process.env.DAYTONA_REPO_PATH?.trim() || `${DEFAULT_DAYTONA_HOME}/repo`

const DEFAULT_AUTO_STOP_MINUTES = 30
const DEFAULT_AUTO_ARCHIVE_MINUTES = 7 * 24 * 60
const DEFAULT_AUTO_DELETE_MINUTES = 30 * 24 * 60
const DEFAULT_CREATE_TIMEOUT_SECONDS = 480
const DEFAULT_SANDBOX_CPU = 2
const DEFAULT_SANDBOX_DISK = 10
const DEFAULT_SANDBOX_MEMORY = 4
const DEFAULT_DAYTONA_SNAPSHOT = "cloudcode-batteries-included"
const DEFAULT_DAYTONA_IMAGE =
  "mcr.microsoft.com/devcontainers/universal:2-linux"
const DAYTONA_SYSTEM_PATH_ENTRIES = [
  "/home/codespace/.dotnet",
  "/home/codespace/nvm/current/bin",
  "/home/codespace/.php/current/bin",
  "/home/codespace/.python/current/bin",
  "/home/codespace/java/current/bin",
  "/home/codespace/.ruby/current/bin",
  "/home/codespace/.local/bin",
  "/usr/local/python/current/bin",
  "/usr/local/py-utils/bin",
  "/usr/local/jupyter",
  "/usr/local/oryx",
  "/usr/local/go/bin",
  "/go/bin",
  "/usr/local/sdkman/bin",
  "/usr/local/sdkman/candidates/java/current/bin",
  "/usr/local/sdkman/candidates/gradle/current/bin",
  "/usr/local/sdkman/candidates/maven/current/bin",
  "/usr/local/sdkman/candidates/ant/current/bin",
  "/usr/local/rvm/gems/default/bin",
  "/usr/local/rvm/gems/default@global/bin",
  "/usr/local/rvm/rubies/default/bin",
  "/usr/local/rvm/bin",
  "/usr/local/share/rbenv/bin",
  "/usr/local/php/current/bin",
  "/opt/conda/bin",
  "/opt/flutter/bin",
  "/opt/flutter/bin/cache/dart-sdk/bin",
  "/usr/local/cargo/bin",
  "/opt/kotlinc/bin",
  "/usr/local/nvs",
  "/usr/local/share/nvm/current/bin",
  "/usr/local/hugo/bin",
  "/usr/local/share/npm-global/bin",
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
  "/usr/share/dotnet",
]

export type DaytonaUiState = "running" | "stopped" | "deleted" | "error"

export type DaytonaSandboxInfo = {
  autoArchiveInterval: number | null
  autoDeleteInterval: number | null
  autoStopInterval: number | null
  createdAt: number | null
  lastActivityAt: number | null
  rawState?: string
  sandboxId: string
  state: DaytonaUiState
  updatedAt: number | null
}

export type DaytonaCommandResult = {
  exitCode: number
  stderr: string
  stdout: string
}

export type DaytonaRunCommandOptions = {
  cwd?: string
  env?: Record<string, string | undefined>
  onStderr?: (chunk: string) => void
  onStdout?: (chunk: string) => void
  timeoutMs?: number
}

export type DaytonaSandboxPaths = {
  baseRefPath: string
  cloudcodeProfilePath: string
  codexHome: string
  codexLauncherPath: string
  home: string
  lastMessagePath: string
  presetEnvPath: string
  previousDiffPath: string
  promptPath: string
  repoPath: string
  runtimeHome: string
}

function envNumber(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export function defaultDaytonaAutostopMinutes() {
  return Math.max(
    1,
    Math.round(
      envNumber("DAYTONA_AUTO_STOP_MINUTES", DEFAULT_AUTO_STOP_MINUTES)
    )
  )
}

export function defaultDaytonaArchiveMinutes() {
  return Math.max(
    0,
    Math.round(
      envNumber("DAYTONA_AUTO_ARCHIVE_MINUTES", DEFAULT_AUTO_ARCHIVE_MINUTES)
    )
  )
}

export function defaultDaytonaDeleteMinutes() {
  return Math.round(
    envNumber("DAYTONA_AUTO_DELETE_MINUTES", DEFAULT_AUTO_DELETE_MINUTES)
  )
}

export function defaultDaytonaCreateTimeoutSeconds() {
  return Math.max(
    30,
    Math.round(
      envNumber(
        "DAYTONA_CREATE_TIMEOUT_SECONDS",
        DEFAULT_CREATE_TIMEOUT_SECONDS
      )
    )
  )
}

export function defaultDaytonaSandboxResources() {
  return {
    cpu: Math.max(
      1,
      Math.round(envNumber("DAYTONA_SANDBOX_CPU", DEFAULT_SANDBOX_CPU))
    ),
    disk: Math.max(
      1,
      Math.round(envNumber("DAYTONA_SANDBOX_DISK", DEFAULT_SANDBOX_DISK))
    ),
    memory: Math.max(
      1,
      Math.round(envNumber("DAYTONA_SANDBOX_MEMORY", DEFAULT_SANDBOX_MEMORY))
    ),
  }
}

export function daytonaAutostopMinutesForRun(timeoutMs: number) {
  const requested = Math.ceil(timeoutMs / 60_000) + 10
  return Math.max(defaultDaytonaAutostopMinutes(), requested)
}

export function defaultDaytonaSnapshot() {
  return (
    process.env.DAYTONA_DEFAULT_SNAPSHOT?.trim() || DEFAULT_DAYTONA_SNAPSHOT
  )
}

export function defaultDaytonaImage() {
  return process.env.DAYTONA_DEFAULT_IMAGE?.trim() || DEFAULT_DAYTONA_IMAGE
}

export function daytonaUserPathEntries(home: string) {
  const cleanHome = home.replace(/\/+$/, "")
  return [
    `${cleanHome}/.local/share/mise/shims`,
    `${cleanHome}/.local/share/mise/bin`,
    `${cleanHome}/.mise/shims`,
    `${cleanHome}/.asdf/shims`,
    `${cleanHome}/.asdf/bin`,
    `${cleanHome}/.local/bin`,
    `${cleanHome}/.local/share/pnpm`,
    `${cleanHome}/.bun/bin`,
    `${cleanHome}/.vite-plus/bin`,
    `${cleanHome}/.cargo/bin`,
    `${cleanHome}/.deno/bin`,
    `${cleanHome}/.dotnet/tools`,
    `${cleanHome}/.foundry/bin`,
    `${cleanHome}/.npm-global/bin`,
    `${cleanHome}/.npm/bin`,
    `${cleanHome}/.nvm/current/bin`,
    `${cleanHome}/.pub-cache/bin`,
    `${cleanHome}/.pyenv/shims`,
    `${cleanHome}/.rbenv/shims`,
    `${cleanHome}/.rvm/bin`,
    `${cleanHome}/.volta/bin`,
    `${cleanHome}/.yarn/bin`,
    `${cleanHome}/.config/yarn/global/node_modules/.bin`,
    `${cleanHome}/go/bin`,
  ]
}

function uniquePathEntries(entries: string[]) {
  return [...new Set(entries.filter(Boolean))]
}

export function daytonaPathForHomes(homes: string[]) {
  return uniquePathEntries([
    ...homes.flatMap((home) => daytonaUserPathEntries(home)),
    ...DAYTONA_SYSTEM_PATH_ENTRIES,
  ]).join(":")
}

export function daytonaTerminalPath(home: string) {
  return daytonaPathForHomes([home])
}

export function daytonaCodexPath(
  paths: Pick<DaytonaSandboxPaths, "home" | "runtimeHome">
) {
  return daytonaPathForHomes([paths.runtimeHome, paths.home])
}

export function getDaytonaClient() {
  return new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET,
  })
}

export async function resolveDaytonaPaths(
  sandbox?: Sandbox
): Promise<DaytonaSandboxPaths> {
  const home =
    (sandbox
      ? await sandbox.getUserHomeDir().catch(() => undefined)
      : undefined
    )?.trim() || DEFAULT_DAYTONA_HOME
  const repoPath =
    process.env.DAYTONA_REPO_PATH?.trim() || `${home.replace(/\/+$/, "")}/repo`
  const runtimeHome =
    process.env.DAYTONA_CODEX_RUNTIME_HOME?.trim() ||
    `${home.replace(/\/+$/, "")}/.cloudcode-home`
  const codexHome =
    process.env.DAYTONA_CODEX_HOME?.trim() || `${runtimeHome}/.codex`

  return {
    baseRefPath: "/tmp/cloudcode-base-ref.txt",
    cloudcodeProfilePath: `${home}/.cloudcode-profile`,
    codexHome,
    codexLauncherPath: "/tmp/cloudcode-codex-latest",
    home,
    lastMessagePath: "/tmp/cloudcode-last-message.txt",
    presetEnvPath: `${codexHome}/cloudcode-preset-env.sh`,
    previousDiffPath: "/tmp/cloudcode-previous.diff",
    promptPath: "/tmp/cloudcode-prompt.txt",
    repoPath,
    runtimeHome,
  }
}

export function normalizeDaytonaState(state?: string): DaytonaUiState {
  if (state === "destroyed" || state === "destroying") {
    return "deleted"
  }
  if (state === "error" || state === "build_failed") return "error"
  if (
    state === "stopped" ||
    state === "stopping" ||
    state === "archived" ||
    state === "archiving"
  ) {
    return "stopped"
  }
  return "running"
}

function timeValue(value?: string) {
  return value ? new Date(value).getTime() : null
}

export async function readDaytonaSandboxInfo(
  sandboxId: string
): Promise<DaytonaSandboxInfo> {
  const sandbox = await getDaytonaSandbox(sandboxId)
  await sandbox.refreshData().catch(() => undefined)

  return {
    autoArchiveInterval: sandbox.autoArchiveInterval ?? null,
    autoDeleteInterval: sandbox.autoDeleteInterval ?? null,
    autoStopInterval: sandbox.autoStopInterval ?? null,
    createdAt: timeValue(sandbox.createdAt),
    lastActivityAt: timeValue(sandbox.lastActivityAt),
    rawState: sandbox.state,
    sandboxId: sandbox.id,
    state: normalizeDaytonaState(sandbox.state),
    updatedAt: timeValue(sandbox.updatedAt),
  }
}

export async function ensureDaytonaSandboxStarted(sandbox: Sandbox) {
  const timeout = defaultDaytonaCreateTimeoutSeconds()
  await sandbox.refreshData().catch(() => undefined)

  if (sandbox.recoverable) {
    await sandbox.recover(timeout)
  } else if (sandbox.state !== "started") {
    await sandbox.start(timeout)
  }

  await sandbox.refreshActivity().catch(() => undefined)
  return sandbox
}

export async function createDaytonaSandbox({
  envVars,
  name,
  snapshot,
}: {
  envVars?: Record<string, string>
  name?: string
  snapshot?: string
}) {
  const requestedSnapshot = snapshot?.trim()
  const configuredDefaultSnapshot = defaultDaytonaSnapshot()
  const daytona = getDaytonaClient()
  const resolvedSnapshot = requestedSnapshot || configuredDefaultSnapshot
  const baseParams = {
    autoArchiveInterval: defaultDaytonaArchiveMinutes(),
    autoDeleteInterval: defaultDaytonaDeleteMinutes(),
    autoStopInterval: defaultDaytonaAutostopMinutes(),
    envVars,
    language: "typescript",
    labels: {
      app: "cloudcode",
      ...(name ? { preset: name } : {}),
    },
    public: false,
  }

  let sandbox: Sandbox
  if (resolvedSnapshot) {
    sandbox = await daytona.create(
      {
        ...baseParams,
        snapshot: resolvedSnapshot,
      },
      { timeout: defaultDaytonaCreateTimeoutSeconds() }
    )
  } else {
    sandbox = await daytona.create(
      {
        ...baseParams,
        image: defaultDaytonaImage(),
        resources: defaultDaytonaSandboxResources(),
      },
      { timeout: defaultDaytonaCreateTimeoutSeconds() }
    )
  }
  await ensureDaytonaSandboxStarted(sandbox)
  await installDaytonaTarWrapper(sandbox, await resolveDaytonaPaths(sandbox))
  return sandbox
}

export async function getDaytonaSandbox(sandboxId: string) {
  const sandbox = await getDaytonaClient().get(sandboxId)
  return sandbox
}

export async function getStartedDaytonaSandbox(sandboxId: string) {
  return await ensureDaytonaSandboxStarted(await getDaytonaSandbox(sandboxId))
}

export async function deleteDaytonaSandboxQuietly(sandboxId?: string) {
  if (!sandboxId) return
  try {
    const sandbox = await getDaytonaSandbox(sandboxId)
    await sandbox.delete(120)
  } catch {
    // Deleting is best-effort cleanup.
  }
}

export async function stopDaytonaSandbox(sandboxId: string) {
  const sandbox = await getDaytonaSandbox(sandboxId)
  await sandbox.stop(120, true)
  return await readDaytonaSandboxInfo(sandboxId)
}

export async function stopDaytonaSandboxQuietly(sandboxId?: string) {
  if (!sandboxId) return
  try {
    await stopDaytonaSandbox(sandboxId)
  } catch {
    // A stopped/missing sandbox is good enough for cancellation cleanup.
  }
}

export async function resumeDaytonaSandbox(sandboxId: string) {
  await getStartedDaytonaSandbox(sandboxId)
  return await readDaytonaSandboxInfo(sandboxId)
}

export async function setDaytonaRunAutostop(
  sandbox: Sandbox,
  timeoutMs: number
) {
  await sandbox
    .setAutostopInterval(daytonaAutostopMinutesForRun(timeoutMs))
    .catch(() => undefined)
  await sandbox.refreshActivity().catch(() => undefined)
}

export async function restoreDaytonaAutostop(sandbox: Sandbox) {
  await sandbox
    .setAutostopInterval(defaultDaytonaAutostopMinutes())
    .catch(() => undefined)
  await sandbox.refreshActivity().catch(() => undefined)
}

function timeoutSeconds(timeoutMs?: number) {
  if (!timeoutMs) return undefined
  return Math.max(1, Math.ceil(timeoutMs / 1000))
}

function validEnvName(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

// Tool installers often call tar as root; user-namespaced sandbox storage can
// reject archive uid/gid ownership, so extraction must ignore stored owners.
const DAYTONA_TAR_WRAPPER = [
  "#!/usr/bin/env bash",
  "set -e",
  'real_tar="/usr/bin/tar"',
  '[ -x "$real_tar" ] || real_tar="/bin/tar"',
  'if [ ! -x "$real_tar" ]; then',
  '  echo "Unable to find system tar." >&2',
  "  exit 127",
  "fi",
  "extract=0",
  "index=0",
  'for arg in "$@"; do',
  "  index=$((index + 1))",
  '  case "$arg" in',
  "    --extract|-x|-*x*) extract=1 ;;",
  "    --) break ;;",
  "    --*) ;;",
  "    -*) ;;",
  '    *) if [ "$index" = "1" ]; then case "$arg" in *x*) extract=1 ;; esac; fi ;;',
  "  esac",
  "done",
  'if [ "$extract" = "1" ]; then',
  '  exec "$real_tar" --no-same-owner --no-same-permissions "$@"',
  "fi",
  'exec "$real_tar" "$@"',
  "",
].join("\n")

export async function installDaytonaTarWrapper(
  sandbox: Sandbox,
  paths: Pick<DaytonaSandboxPaths, "home">
) {
  const binDir = `${paths.home}/.local/bin`
  const wrapperPath = `${binDir}/tar`

  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -eo pipefail",
      `mkdir -p ${shellQuote(binDir)}`,
      `cat > ${shellQuote(wrapperPath)} <<'EOF'`,
      DAYTONA_TAR_WRAPPER.trimEnd(),
      "EOF",
      `chmod +x ${shellQuote(wrapperPath)}`,
      `ln -sf ${shellQuote(wrapperPath)} /usr/local/bin/tar 2>/dev/null || true`,
      `${shellQuote(wrapperPath)} --version >/dev/null`,
    ].join("\n"),
    { cwd: paths.home, timeoutMs: 10_000 }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Unable to install sandbox tar wrapper."
    )
  }
}

function buildSessionCommand(
  command: string,
  options: DaytonaRunCommandOptions
) {
  const envEntries = Object.entries(options.env ?? {}).filter(
    (entry): entry is [string, string] =>
      validEnvName(entry[0]) && typeof entry[1] === "string"
  )
  const env = envEntries
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(" ")
  const envExports = envEntries
    .map(([name, value]) => `export ${name}=${shellQuote(value)}`)
    .join("\n")
  const script = [
    envExports,
    options.cwd ? `cd ${shellQuote(options.cwd)}` : "",
    command,
  ]
    .filter(Boolean)
    .join("\n")

  return `${env ? `env ${env} ` : ""}bash -lc ${shellQuote(script)}`
}

async function waitForCommandExit(
  sandbox: Sandbox,
  sessionId: string,
  commandId: string,
  timeoutMs?: number
) {
  const deadline = Date.now() + (timeoutMs ?? 10 * 60 * 1000)
  let command = await sandbox.process.getSessionCommand(sessionId, commandId)

  while (command.exitCode === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    command = await sandbox.process.getSessionCommand(sessionId, commandId)
  }

  return command.exitCode ?? 124
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function runDaytonaCommand(
  sandbox: Sandbox,
  command: string,
  options: DaytonaRunCommandOptions = {}
): Promise<DaytonaCommandResult> {
  const sessionId = `cloudcode-${Date.now()}-${randomUUID().slice(0, 8)}`
  const timeout = timeoutSeconds(options.timeoutMs)
  const wrappedCommand = buildSessionCommand(command, options)

  await sandbox.process.createSession(sessionId)

  try {
    if (options.onStdout || options.onStderr) {
      const response = await sandbox.process.executeSessionCommand(
        sessionId,
        {
          command: wrappedCommand,
          runAsync: true,
          suppressInputEcho: true,
        },
        timeout
      )
      const commandId = response.cmdId
      let stdout = ""
      let stderr = ""

      const logsPromise = sandbox.process
        .getSessionCommandLogs(
          sessionId,
          commandId,
          (chunk) => {
            stdout += chunk
            options.onStdout?.(chunk)
          },
          (chunk) => {
            stderr += chunk
            options.onStderr?.(chunk)
          }
        )
        .catch(() => undefined)

      const exitCode = await waitForCommandExit(
        sandbox,
        sessionId,
        commandId,
        options.timeoutMs
      )

      await Promise.race([logsPromise, wait(1_000)])

      return {
        exitCode,
        stderr,
        stdout,
      }
    }

    const response = await sandbox.process.executeSessionCommand(
      sessionId,
      {
        command: wrappedCommand,
        suppressInputEcho: true,
      },
      timeout
    )

    return {
      exitCode: response.exitCode ?? 0,
      stderr: response.stderr ?? "",
      stdout: response.stdout ?? response.output ?? "",
    }
  } finally {
    await sandbox.process.deleteSession(sessionId).catch(() => undefined)
  }
}

export async function readDaytonaTextFile(sandbox: Sandbox, path: string) {
  return (await sandbox.fs.downloadFile(path)).toString("utf8")
}

export async function readDaytonaFile(sandbox: Sandbox, path: string) {
  return await sandbox.fs.downloadFile(path)
}

export async function writeDaytonaTextFile(
  sandbox: Sandbox,
  path: string,
  content: string
) {
  await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), path)
}

export async function getDaytonaTerminalUrl(sandboxId: string) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  const signed = await sandbox.getSignedPreviewUrl(DAYTONA_TERMINAL_PORT, 3600)
  return signed.url
}
