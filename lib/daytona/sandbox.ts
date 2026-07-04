import { Daytona, type Sandbox } from "@daytona/sdk"

import {
  daytonaBillingState,
  type DaytonaBillingResources,
  type DaytonaBillingState,
} from "@/lib/billing/model"
import { envNumber } from "@/lib/daytona/env"
import { installDaytonaTarWrapper } from "@/lib/daytona/sandbox-command"
import { clampSandboxIdleMinutes } from "@/lib/sandbox/idle"

export {
  installDaytonaTarWrapper,
  runDaytonaCommand,
  shellQuote,
} from "@/lib/daytona/sandbox-command"
export type {
  DaytonaCommandResult,
  DaytonaRunCommandOptions,
} from "@/lib/daytona/sandbox-command"

const DAYTONA_TERMINAL_PORT = 22222
const DEFAULT_SSH_ACCESS_MINUTES = 60
const DEFAULT_DAYTONA_HOME =
  process.env.DAYTONA_SANDBOX_HOME?.trim() || "/home/daytona"

const DEFAULT_AUTO_ARCHIVE_MINUTES = 7 * 24 * 60
const DEFAULT_AUTO_DELETE_MINUTES = 14 * 24 * 60
const DEFAULT_CREATE_TIMEOUT_SECONDS = 480
const DEFAULT_READ_TIMEOUT_MS = 15_000
const DEFAULT_SANDBOX_CPU = 2
const DEFAULT_SANDBOX_DISK = 8
const DEFAULT_SANDBOX_MEMORY = 4
const DEFAULT_DAYTONA_SNAPSHOT = "cloudcode-batteries-included"
const DEFAULT_DAYTONA_IMAGE = "daytonaio/sandbox:0.8.0"
const DAYTONA_ACTIVITY_HEARTBEAT_MAX_MS = 60_000
const DAYTONA_ACTIVITY_HEARTBEAT_MIN_MS = 15_000
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

export class DaytonaSandboxNotRunningError extends Error {
  constructor() {
    super("Sandbox is not running.")
    this.name = "DaytonaSandboxNotRunningError"
  }
}

export type DaytonaSandboxInfo = {
  autoArchiveInterval: number | null
  autoDeleteInterval: number | null
  autoStopInterval: number | null
  billingState: DaytonaBillingState
  createdAt: number | null
  cpu: number
  diskGiB: number
  lastActivityAt: number | null
  memoryGiB: number
  rawState?: string
  sandboxId: string
  state: DaytonaUiState
  updatedAt: number | null
}

const CLOUDCODE_RUN_LABEL = "cloudcode-run-id"

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

async function ensureDaytonaAutostopInterval(
  sandbox: Sandbox,
  autoStopMinutes?: number
) {
  // Secondary operations (terminal, desktop, env edits) start a sandbox without
  // knowing the owner's preference. When no explicit value is supplied, keep any
  // interval the sandbox already carries so we never clobber a user's choice
  // back to the default.
  if (
    autoStopMinutes == null &&
    sandbox.autoStopInterval != null &&
    sandbox.autoStopInterval > 0
  ) {
    return
  }

  const interval = clampSandboxIdleMinutes(autoStopMinutes)
  if (sandbox.autoStopInterval === interval) return

  await sandbox.setAutostopInterval(interval)
  sandbox.autoStopInterval = interval
}

function defaultDaytonaArchiveMinutes() {
  return Math.max(
    0,
    Math.round(
      envNumber("DAYTONA_AUTO_ARCHIVE_MINUTES", DEFAULT_AUTO_ARCHIVE_MINUTES)
    )
  )
}

function defaultDaytonaDeleteMinutes() {
  return Math.round(
    envNumber("DAYTONA_AUTO_DELETE_MINUTES", DEFAULT_AUTO_DELETE_MINUTES)
  )
}

function defaultDaytonaCreateTimeoutSeconds() {
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

export function defaultDaytonaSnapshot() {
  return (
    process.env.DAYTONA_DEFAULT_SNAPSHOT?.trim() || DEFAULT_DAYTONA_SNAPSHOT
  )
}

function defaultDaytonaImage() {
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

function daytonaPathForHomes(homes: string[]) {
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

/**
 * mise walks ancestor directories of the cwd (and $HOME) looking for config
 * files, so a snapshot-baked config such as ~/.config/mise/config.toml gets
 * loaded alongside the repo's. Untrusted configs make mise abort, which kills
 * the Codex launcher. Trust both sandbox homes in addition to the repo so no
 * config discovered this way ever hits the interactive `mise trust` prompt.
 */
export function miseTrustedConfigPaths(
  paths: Pick<DaytonaSandboxPaths, "home" | "repoPath" | "runtimeHome">
) {
  return uniquePathEntries([
    paths.repoPath,
    paths.home.replace(/\/+$/, ""),
    paths.runtimeHome.replace(/\/+$/, ""),
  ]).join(":")
}

export function repoCommandEnv(
  paths: Pick<DaytonaSandboxPaths, "home" | "repoPath" | "runtimeHome">,
  extraEnv: Record<string, string> = {}
) {
  return {
    HOME: paths.runtimeHome,
    MISE_TRUSTED_CONFIG_PATHS: miseTrustedConfigPaths(paths),
    PATH: daytonaCodexPath(paths),
    ...extraEnv,
  }
}

function getDaytonaClient() {
  return new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET,
  })
}

// The user home dir cannot change for a live sandbox, but resolving it costs
// a Daytona API call — and nearly every route resolves paths. Cache it per
// sandbox id (bounded, insertion-order eviction).
const SANDBOX_HOME_CACHE_MAX_ENTRIES = 500
const sandboxHomeCache = new Map<string, string>()

async function resolveSandboxHome(sandbox?: Sandbox) {
  if (!sandbox) return DEFAULT_DAYTONA_HOME

  const cached = sandboxHomeCache.get(sandbox.id)
  if (cached) return cached

  const resolved = (
    await sandbox.getUserHomeDir().catch(() => undefined)
  )?.trim()
  if (!resolved) return DEFAULT_DAYTONA_HOME

  sandboxHomeCache.set(sandbox.id, resolved)
  while (sandboxHomeCache.size > SANDBOX_HOME_CACHE_MAX_ENTRIES) {
    const oldest = sandboxHomeCache.keys().next()
    if (oldest.done) break
    sandboxHomeCache.delete(oldest.value)
  }
  return resolved
}

export async function resolveDaytonaPaths(
  sandbox?: Sandbox
): Promise<DaytonaSandboxPaths> {
  const home = await resolveSandboxHome(sandbox)
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

function normalizeDaytonaState(state?: string): DaytonaUiState {
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

export class DaytonaOperationTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms.`)
    this.name = "DaytonaOperationTimeoutError"
  }
}

export function isDaytonaOperationTimeoutError(
  error: unknown
): error is DaytonaOperationTimeoutError {
  return error instanceof DaytonaOperationTimeoutError
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object")
}

export function isDaytonaNotFoundError(error: unknown) {
  if (!isRecord(error)) return false
  const message =
    typeof error.message === "string" ? error.message.toLowerCase() : ""
  return (
    error.name === "DaytonaNotFoundError" ||
    error.statusCode === 404 ||
    error.status === 404 ||
    error.code === 404 ||
    error.code === "NOT_FOUND" ||
    (message.includes("sandbox") && message.includes("not found"))
  )
}

function defaultDaytonaReadTimeoutMs() {
  return Math.max(
    1_000,
    Math.round(envNumber("DAYTONA_READ_TIMEOUT_MS", DEFAULT_READ_TIMEOUT_MS))
  )
}

export async function withDaytonaOperationTimeout<T>(
  promise: Promise<T>,
  {
    label,
    timeoutMs = defaultDaytonaReadTimeoutMs(),
  }: {
    label: string
    timeoutMs?: number
  }
): Promise<T> {
  let timedOut = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  promise.catch(() => undefined)

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true
      reject(new DaytonaOperationTimeoutError(label, timeoutMs))
    }, timeoutMs)
    timeout.unref?.()
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
    if (timedOut) {
      promise.catch((error) => {
        console.warn(`${label} completed after timeout.`, error)
      })
    }
  }
}

export async function refreshDaytonaSandboxData(
  sandbox: Sandbox,
  options: { timeoutMs?: number } = {}
) {
  await withDaytonaOperationTimeout(sandbox.refreshData(), {
    label: "Daytona sandbox refresh",
    timeoutMs: options.timeoutMs,
  })
}

export async function readDaytonaSandboxInfo(
  sandboxId: string,
  options: { timeoutMs?: number } = {}
): Promise<DaytonaSandboxInfo> {
  const sandbox = await getDaytonaSandbox(sandboxId, options)
  await refreshDaytonaSandboxData(sandbox, options).catch((error) => {
    if (isDaytonaOperationTimeoutError(error)) throw error
    return undefined
  })

  return daytonaSandboxInfo(sandbox)
}

function daytonaSandboxInfo(sandbox: Sandbox): DaytonaSandboxInfo {
  const resources = daytonaSandboxBillingResources(sandbox)

  return {
    autoArchiveInterval: sandbox.autoArchiveInterval ?? null,
    autoDeleteInterval: sandbox.autoDeleteInterval ?? null,
    autoStopInterval: sandbox.autoStopInterval ?? null,
    billingState: daytonaBillingState(sandbox.state),
    createdAt: timeValue(sandbox.createdAt),
    cpu: resources.cpu,
    diskGiB: resources.diskGiB,
    lastActivityAt: timeValue(sandbox.lastActivityAt),
    memoryGiB: resources.memoryGiB,
    rawState: sandbox.state,
    sandboxId: sandbox.id,
    state: normalizeDaytonaState(sandbox.state),
    updatedAt: timeValue(sandbox.updatedAt),
  }
}

export function daytonaSandboxBillingResources(
  sandbox: Pick<Sandbox, "cpu" | "disk" | "memory">
): DaytonaBillingResources {
  const fallback = defaultDaytonaSandboxResources()

  return {
    cpu:
      Number.isFinite(sandbox.cpu) && sandbox.cpu > 0
        ? sandbox.cpu
        : fallback.cpu,
    diskGiB:
      Number.isFinite(sandbox.disk) && sandbox.disk > 0
        ? sandbox.disk
        : fallback.disk,
    memoryGiB:
      Number.isFinite(sandbox.memory) && sandbox.memory > 0
        ? sandbox.memory
        : fallback.memory,
  }
}

export async function findDaytonaSandboxInfoForRun(runId: string) {
  const trimmedRunId = runId.trim()
  if (!trimmedRunId) return null

  const result = await getDaytonaClient().list(
    {
      [CLOUDCODE_RUN_LABEL]: trimmedRunId,
      app: "cloudcode",
    },
    1,
    10
  )
  let sandbox: Sandbox | undefined
  let sandboxCreatedAt = 0
  for (const candidate of result.items) {
    if (normalizeDaytonaState(candidate.state) === "deleted") continue
    const createdAt = timeValue(candidate.createdAt) ?? 0
    if (!sandbox || createdAt > sandboxCreatedAt) {
      sandbox = candidate
      sandboxCreatedAt = createdAt
    }
  }

  if (!sandbox) return null
  await sandbox.refreshData().catch(() => undefined)
  return daytonaSandboxInfo(sandbox)
}

export async function ensureDaytonaSandboxStarted(
  sandbox: Sandbox,
  autoStopMinutes?: number
) {
  const timeout = defaultDaytonaCreateTimeoutSeconds()
  await sandbox.refreshData().catch(() => undefined)

  if (sandbox.recoverable) {
    await sandbox.recover(timeout)
  } else if (sandbox.state !== "started") {
    await sandbox.start(timeout)
  }

  await ensureDaytonaAutostopInterval(sandbox, autoStopMinutes)
  await sandbox.refreshActivity().catch(() => undefined)
  return sandbox
}

export async function createDaytonaSandbox({
  autoStopMinutes,
  envVars,
  labels,
  name,
  snapshot,
}: {
  autoStopMinutes?: number
  envVars?: Record<string, string>
  labels?: Record<string, string | undefined>
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
    autoStopInterval: clampSandboxIdleMinutes(autoStopMinutes),
    envVars,
    language: "typescript",
    labels: {
      app: "cloudcode",
      ...Object.fromEntries(
        Object.entries(labels ?? {}).filter(
          (entry): entry is [string, string] => Boolean(entry[1]?.trim())
        )
      ),
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
  await ensureDaytonaSandboxStarted(sandbox, autoStopMinutes)
  await installDaytonaTarWrapper(sandbox, await resolveDaytonaPaths(sandbox))
  return sandbox
}

export async function getDaytonaSandbox(
  sandboxId: string,
  options: { timeoutMs?: number } = {}
) {
  return await withDaytonaOperationTimeout(getDaytonaClient().get(sandboxId), {
    label: "Daytona sandbox lookup",
    timeoutMs: options.timeoutMs,
  })
}

export async function getStartedDaytonaSandbox(
  sandboxId: string,
  autoStopMinutes?: number
) {
  return await ensureDaytonaSandboxStarted(
    await getDaytonaSandbox(sandboxId),
    autoStopMinutes
  )
}

export async function getRunningDaytonaSandbox(
  sandboxId: string,
  options: { timeoutMs?: number } = {}
) {
  const sandbox = await getDaytonaSandbox(sandboxId, options)
  await refreshDaytonaSandboxData(sandbox, options).catch((error) => {
    if (isDaytonaOperationTimeoutError(error)) throw error
    return undefined
  })

  if (normalizeDaytonaState(sandbox.state) !== "running") {
    throw new DaytonaSandboxNotRunningError()
  }

  return sandbox
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

export async function resumeDaytonaSandbox(sandboxId: string) {
  await getStartedDaytonaSandbox(sandboxId)
  return await readDaytonaSandboxInfo(sandboxId)
}

export function startDaytonaActivityHeartbeat(
  sandbox: Sandbox,
  autoStopMinutes?: number
) {
  const intervalMs = Math.min(
    DAYTONA_ACTIVITY_HEARTBEAT_MAX_MS,
    Math.max(
      DAYTONA_ACTIVITY_HEARTBEAT_MIN_MS,
      Math.floor((clampSandboxIdleMinutes(autoStopMinutes) * 60_000) / 2)
    )
  )
  let stopped = false

  const refreshActivity = () => {
    if (stopped) return
    void sandbox.refreshActivity().catch(() => undefined)
  }

  refreshActivity()
  const heartbeat = setInterval(refreshActivity, intervalMs)
  heartbeat.unref?.()

  return () => {
    stopped = true
    clearInterval(heartbeat)
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

export async function writeDaytonaFile(
  sandbox: Sandbox,
  path: string,
  content: Buffer
) {
  await sandbox.fs.uploadFile(content, path)
}

export async function getDaytonaTerminalUrl(
  sandboxId: string,
  options: { sandbox?: Sandbox } = {}
) {
  const sandbox = options.sandbox ?? (await getRunningDaytonaSandbox(sandboxId))
  const signed = await sandbox.getSignedPreviewUrl(DAYTONA_TERMINAL_PORT, 3600)
  return signed.url
}

export type DaytonaSshAccess = {
  accessId: string
  token: string
  sshCommand: string
  expiresAt: string
}

export async function createDaytonaSshAccess(
  sandboxId: string,
  expiresInMinutes = DEFAULT_SSH_ACCESS_MINUTES
): Promise<DaytonaSshAccess> {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  const access = await sandbox.createSshAccess(expiresInMinutes)
  return {
    accessId: access.id,
    token: access.token,
    sshCommand: access.sshCommand,
    expiresAt: new Date(access.expiresAt).toISOString(),
  }
}

export async function revokeDaytonaSshAccess(sandboxId: string, token: string) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await sandbox.revokeSshAccess(token)
}
