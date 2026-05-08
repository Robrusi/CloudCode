import { createHash } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import {
  defaultBranchName,
  defaultBranchNameWithSuffix,
  shuffledCityBranchNames,
} from "./codex-branch-names"
import {
  createDaytonaSandbox,
  daytonaCodexPath,
  daytonaTerminalPath,
  daytonaUserPathEntries,
  defaultDaytonaSnapshot,
  defaultDaytonaSandboxResources,
  ensureDaytonaSandboxStarted,
  getDaytonaSandbox,
  readDaytonaTextFile,
  resolveDaytonaPaths,
  restoreDaytonaAutostop,
  runDaytonaCommand,
  setDaytonaRunAutostop,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaCommandResult,
  type DaytonaSandboxPaths,
} from "./daytona-sandbox"
import {
  CLOUDCODE_LEGACY_PRESET_ENV_PATH,
  withoutCloudcodeEnvLocal,
  writeCloudcodeEnvLocal,
  type SandboxEnvTarget,
  type SandboxPresetEnvVar,
} from "./sandbox-env"

const EXIT_MARKER = "__CLOUDCODE_CODEX_EXIT__"
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000
const CODEX_UPDATE_TIMEOUT_MS = 3 * 60 * 1000
const PRESET_INSTALL_TIMEOUT_MS = 10 * 60 * 1000

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
  daytonaSnapshot?: string
  installScript?: string
  name: string
  pathInstallScript?: string
  secrets: SandboxPresetEnvVar[]
}

export type RunCodexInSandboxInput = {
  authJson: string
  baseBranch?: string
  branchName?: string
  codexThreadId?: string
  githubToken?: string
  model?: string
  onLog?: (log: RunCodexLog) => void | Promise<void>
  previousDiff?: string
  prompt: string
  reasoningEffort?: ReasoningEffort
  resumeContext?: string
  repoUrl: string
  sandboxId?: string
  sandboxPreset?: SandboxPresetInput
  speed?: CodexSpeed
  timeoutMs?: number
}

export type RunCodexInSandboxResult = {
  branchName: string
  codexThreadId?: string
  diff: string
  exitCode: number
  lastMessage: string
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

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return undefined
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readableCodexText(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown
    const nested = findString(parsed, ["detail", "message", "error"])
    return nested && nested !== value ? readableCodexText(nested) : value
  } catch {
    return value
  }
}

function codexThreadIdFromEvent(event: unknown) {
  const record = objectRecord(event)
  if (!record) return undefined

  const type = stringValue(record.type)
  const threadId = stringValue(record.thread_id)
  return type === "thread.started" ? threadId : undefined
}

function findString(
  value: unknown,
  keys: readonly string[],
  depth = 0
): string | undefined {
  const record = objectRecord(value)
  if (!record || depth > 3) return undefined

  for (const key of keys) {
    const found = stringValue(record[key])
    if (found) return found
  }

  for (const nested of Object.values(record)) {
    const found = findString(nested, keys, depth + 1)
    if (found) return found
  }

  return undefined
}

function summarizeCodexEvent(event: unknown): RunCodexLog | undefined {
  const record = objectRecord(event)
  if (!record) return undefined

  const type = stringValue(record.type)?.toLowerCase() ?? ""
  const status = stringValue(record.status)
  const command = findString(record, ["command", "cmd", "shell_command"])
  const text = findString(record, [
    "summary",
    "message",
    "text",
    "content",
    "delta",
  ])

  if (type.includes("reason")) {
    return {
      kind: "reasoning",
      message: text ? compactLine(readableCodexText(text)) : "Reasoning",
    }
  }

  if (
    command &&
    (type.includes("command") ||
      type.includes("exec") ||
      type.includes("tool") ||
      type.includes("function"))
  ) {
    return {
      detail: status,
      kind: "command",
      message: compactLine(command),
    }
  }

  if (type.includes("turn") && (type.includes("start") || status)) {
    return {
      kind: "setup",
      message: status ? `Codex turn ${status}` : "Codex turn started",
    }
  }

  if (type.includes("error")) {
    return {
      kind: "stderr",
      message: text
        ? compactLine(readableCodexText(text))
        : "Codex reported an error",
    }
  }

  return undefined
}

function summarizeUnknownCodexEvent(event: unknown): RunCodexLog | undefined {
  const record = objectRecord(event)
  if (!record) return undefined

  const type = stringValue(record.type)
  if (!type) return undefined

  const status = stringValue(record.status)
  const text = findString(record, [
    "summary",
    "message",
    "text",
    "content",
    "delta",
    "reason",
    "detail",
  ])

  if (!text && !status) return undefined

  return {
    kind: type.toLowerCase().includes("error") ? "stderr" : "stdout",
    message: compactLine([type, status, text].filter(Boolean).join(": ")),
  }
}

function createStdoutLogger(
  onLog: RunCodexInSandboxInput["onLog"],
  onCodexThreadId: (threadId: string) => void
) {
  let buffer = ""

  function emitPlainLine(line: string) {
    const trimmed = compactLine(line)
    if (!trimmed || trimmed.startsWith(EXIT_MARKER)) return
    void onLog?.({ kind: "stdout", message: trimmed })
  }

  function flushLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return

    try {
      const event = JSON.parse(trimmed) as unknown
      const threadId = codexThreadIdFromEvent(event)
      if (threadId) onCodexThreadId(threadId)
      const summary = summarizeCodexEvent(event)
      if (summary) {
        void onLog?.(summary)
      } else {
        const fallback = summarizeUnknownCodexEvent(event)
        if (fallback) void onLog?.(fallback)
      }
    } catch {
      emitPlainLine(trimmed)
    }
  }

  return {
    chunk(data: string) {
      buffer += data
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""
      for (const line of lines) flushLine(line)
    },
    flush() {
      if (buffer) flushLine(buffer)
      buffer = ""
    },
  }
}

function redactAuthPathOutput(
  result: DaytonaCommandResult,
  paths: DaytonaSandboxPaths
) {
  const exitPattern = new RegExp(`\\n?${EXIT_MARKER}(\\d+)\\s*$`)
  const exitMatch = result.stdout.match(exitPattern)
  const exitCode = exitMatch?.[1] ? Number(exitMatch[1]) : result.exitCode

  return {
    ...result,
    exitCode,
    stderr: result.stderr.replaceAll(paths.codexHome, "$CODEX_HOME"),
    stdout: result.stdout
      .replace(exitPattern, "")
      .replaceAll(paths.codexHome, "$CODEX_HOME"),
  }
}

function restoredConversationPrompt(context: string, prompt: string) {
  return [
    "The previous Daytona sandbox no longer exists, so this is a fresh sandbox. The last saved diff has been applied when available. Use this handoff as the current task state and continue from it.",
    context.trim(),
    "Current user request:",
    prompt,
  ].join("\n\n")
}

function createSandboxTarget(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths
): SandboxEnvTarget {
  return {
    readTextFile: (path) => readDaytonaTextFile(sandbox, path),
    runCommand: (command, options) =>
      runDaytonaCommand(sandbox, command, {
        cwd: paths.home,
        timeoutMs: options?.timeoutMs,
      }),
    writeTextFile: (path, content) =>
      writeDaytonaTextFile(sandbox, path, content),
  }
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
    `export PATH=${shellQuote(daytonaCodexPath(paths))}`,
    preset?.secrets.length ? secretExports(preset.secrets) : "",
  ]
    .filter(Boolean)
    .join("\n")
}

function presetSecretEnv(secrets: SandboxPresetEnvVar[] = []) {
  return Object.fromEntries(secrets.map((secret) => [secret.name, secret.value]))
}

function codexShellEnv(
  paths: DaytonaSandboxPaths,
  secrets: SandboxPresetEnvVar[] = []
) {
  return {
    BASH_ENV: "/dev/null",
    CODEX_HOME: paths.codexHome,
    HOME: paths.runtimeHome,
    PATH: daytonaCodexPath(paths),
    SHELL: "/bin/bash",
    ...presetSecretEnv(secrets),
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
  await sandbox.git.createBranch(paths.repoPath, branchName)
}

async function createDefaultBranch(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths,
  branchName: string
) {
  let lastError: unknown

  for (const candidate of shuffledCityBranchNames(branchName)) {
    try {
      await createBranch(sandbox, input, paths, candidate)
      return candidate
    } catch (error) {
      lastError = error
    }
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = defaultBranchNameWithSuffix()

    try {
      await createBranch(sandbox, input, paths, candidate)
      return candidate
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to create a default branch.")
}

async function connectOrCreateSandbox(input: RunCodexInSandboxInput) {
  const createSandbox = () =>
    createDaytonaSandbox({
      envVars: presetSecretEnv(input.sandboxPreset?.secrets),
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
      if (
        desiredSnapshot &&
        (sandbox.snapshot !== desiredSnapshot || sandboxIsUnderResourced(sandbox))
      ) {
        await sandbox.delete(120).catch(() =>
          sandbox.stop(120, true).catch(() => undefined)
        )
        return {
          recoveredSandbox: true,
          sandbox: await createSandbox(),
        }
      }

      return {
        recoveredSandbox: false,
        sandbox,
      }
    } catch {
      // The DB can outlive an auto-deleted sandbox. Continue in a fresh one.
    }
  }

  return {
    recoveredSandbox: Boolean(input.sandboxId),
    sandbox: await createSandbox(),
  }
}

async function readLastMessage(sandbox: Sandbox, paths: DaytonaSandboxPaths) {
  try {
    return (await readDaytonaTextFile(sandbox, paths.lastMessagePath)).trim()
  } catch {
    return ""
  }
}

async function getCodexExecHelp(sandbox: Sandbox, paths: DaytonaSandboxPaths) {
  try {
    const result = await runDaytonaCommand(
      sandbox,
      `${shellQuote(paths.codexLauncherPath)} exec --help`,
      {
        cwd: paths.home,
        env: codexShellEnv(paths),
        timeoutMs: 10_000,
      }
    )
    return result.stdout
  } catch {
    return ""
  }
}

async function getCodexResumeHelp(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths
) {
  try {
    const result = await runDaytonaCommand(
      sandbox,
      `${shellQuote(paths.codexLauncherPath)} exec resume --help`,
      {
        cwd: paths.home,
        env: codexShellEnv(paths),
        timeoutMs: 10_000,
      }
    )
    return result.stdout
  } catch {
    return ""
  }
}

async function isCodexLauncherReady(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths
) {
  try {
    const result = await runDaytonaCommand(
      sandbox,
      `test -x ${shellQuote(paths.codexLauncherPath)}`,
      { timeoutMs: 10_000 }
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

  const updateCommand = [
    "set -e",
    "if command -v codex >/dev/null 2>&1; then",
    "  true",
    "elif command -v npm >/dev/null 2>&1; then",
    "  npm install -g @openai/codex@latest",
    "elif command -v bun >/dev/null 2>&1; then",
    "  bun install -g @openai/codex@latest",
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
    detail: "runs once when this app thread initializes its Daytona sandbox",
    kind: "command",
    message: "use preinstalled codex or install @openai/codex when needed",
  })

  const result = await runDaytonaCommand(sandbox, updateCommand, {
    cwd: paths.home,
    env: {
      HOME: paths.home,
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
    timeoutMs: CODEX_UPDATE_TIMEOUT_MS,
  })

  if (result.exitCode !== 0) {
    throw new Error(
      [
        "Unable to prepare Codex CLI in the Daytona sandbox.",
        ...[result.stderr, result.stdout].flatMap((value) =>
          value
            .split(/\r?\n/)
            .map((line) => compactLine(line, 300))
            .filter(Boolean)
            .slice(-8)
        ),
      ].join("\n")
    )
  }

  const version =
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
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
  const target = createSandboxTarget(sandbox, paths)

  await runDaytonaCommand(
    sandbox,
    [
      `mkdir -p ${shellQuote(paths.runtimeHome)}`,
      `chmod 700 ${shellQuote(paths.runtimeHome)}`,
      'if [ -x /bin/bash ] && command -v usermod >/dev/null 2>&1; then usermod -s /bin/bash "$(id -un)" 2>/dev/null || true; fi',
      'if [ -x /bin/bash ] && command -v chsh >/dev/null 2>&1; then chsh -s /bin/bash "$(id -un)" 2>/dev/null || true; fi',
      "[ -f /etc/profile.d/rvm.sh ] && mv /etc/profile.d/rvm.sh /etc/profile.d/rvm.sh.cloudcode-disabled 2>/dev/null || true",
      `mkdir -p ${shellQuote(paths.codexHome)}`,
      `chmod 700 ${shellQuote(paths.codexHome)}`,
      `mkdir -p ${shellQuote(paths.home)}`,
      linkSandboxPathToolsCommand(paths),
    ].join(" && "),
    { timeoutMs: 10_000 }
  )
  await writeDaytonaTextFile(
    sandbox,
    paths.presetEnvPath,
    presetProfileSnippet(paths, input.sandboxPreset)
  )
  const runtimeProfile = runtimeShellProfileSnippet(paths, input.sandboxPreset)
  await Promise.all(
    [".bash_profile", ".bash_login", ".profile", ".bashrc"].map((file) =>
      writeDaytonaTextFile(
        sandbox,
        `${paths.runtimeHome}/${file}`,
        runtimeProfile
      )
    )
  )
  await runDaytonaCommand(
    sandbox,
    [
      `chmod 600 ${shellQuote(paths.presetEnvPath)} ${shellQuote(
        `${paths.runtimeHome}/.bash_profile`
      )} ${shellQuote(`${paths.runtimeHome}/.bash_login`)} ${shellQuote(
        `${paths.runtimeHome}/.profile`
      )} ${shellQuote(`${paths.runtimeHome}/.bashrc`)}`,
      `profile_line=${shellQuote(`. ${paths.cloudcodeProfilePath}`)}`,
      `for file in ${shellQuote(`${paths.home}/.bashrc`)} ${shellQuote(`${paths.home}/.profile`)}; do`,
      "  [ -f \"$file\" ] || continue",
      "  tmp=$(mktemp)",
      "  grep -vxF \"$profile_line\" \"$file\" > \"$tmp\" || true",
      "  cat \"$tmp\" > \"$file\"",
      "  rm -f \"$tmp\"",
      "done",
      `rm -f ${shellQuote(paths.cloudcodeProfilePath)}`,
    ].join("\n"),
    { cwd: paths.home, timeoutMs: 10_000 }
  )

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
  paths: DaytonaSandboxPaths
) {
  const script = input.sandboxPreset?.pathInstallScript?.trim()
  if (!script) return

  await emitLog(input, {
    kind: "setup",
    message: `Running ${input.sandboxPreset?.name ?? "preset"} PATH setup script`,
  })
  await emitLog(input, {
    kind: "command",
    message: "preset PATH setup script",
  })

  const terminalPath = daytonaTerminalPath(paths.home)
  const scriptHash = sha256(script)
  const scriptPath = `${paths.codexHome}/path-install-${scriptHash}.sh`
  const markerPath = `${paths.codexHome}/path-install-${scriptHash}.fingerprint`
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
    `if [ -f ${shellQuote(markerPath)} ] && grep -qxF ${shellQuote(
      scriptHash
    )} ${shellQuote(markerPath)}; then`,
    "  echo 'Preset PATH setup script skipped; inputs unchanged.'",
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
      PATH: terminalPath,
      ...presetSecretEnv(input.sandboxPreset?.secrets),
    },
    onStderr: (data) => {
      const trimmed = compactLine(data)
      if (trimmed) void input.onLog?.({ kind: "stderr", message: trimmed })
    },
    onStdout: (data) => {
      const trimmed = compactLine(data)
      if (trimmed) void input.onLog?.({ kind: "stdout", message: trimmed })
    },
    timeoutMs: PRESET_INSTALL_TIMEOUT_MS,
  })

  if (result.exitCode !== 0) {
    const outputLines = [result.stderr, result.stdout].flatMap((value) =>
      value
        .split(/\r?\n/)
        .map((line) => compactLine(line, 300))
        .filter(Boolean)
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
  paths: DaytonaSandboxPaths
) {
  const script = input.sandboxPreset?.installScript?.trim()
  if (!script) return

  await emitLog(input, {
    kind: "setup",
    message: `Running ${input.sandboxPreset?.name ?? "preset"} install script`,
  })
  await emitLog(input, {
    kind: "command",
    message: "preset install script",
  })

  const scriptHash = sha256(script)
  const scriptPath = `${paths.codexHome}/preset-install-${scriptHash}.sh`
  const markerPath = `${paths.codexHome}/preset-install-${scriptHash}.fingerprint`
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
    [
      "manifest_hash=$(",
      "  {",
      "    find . \\( -path './node_modules' -o -path './node_modules/*' -o -path './.next' -o -path './.next/*' -o -path './dist' -o -path './dist/*' -o -path './build' -o -path './build/*' \\) -prune -o -type f \\( -name package.json -o -name pnpm-lock.yaml -o -name package-lock.json -o -name yarn.lock -o -name bun.lock -o -name bun.lockb \\) -print0 | sort -z | xargs -0 -r sha256sum 2>/dev/null || true",
      "    printf '%s' " + shellQuote(scriptHash),
      "  } | sha256sum | awk '{print $1}'",
      ")",
    ].join("\n"),
    `if [ -f ${shellQuote(markerPath)} ] && grep -qxF "$manifest_hash" ${shellQuote(
      markerPath
    )}; then`,
    "  echo 'Preset install script skipped; inputs unchanged.'",
    "  exit 0",
    "fi",
    `chmod +x ${shellQuote(scriptPath)}`,
    `${shellQuote(scriptPath)}`,
    `printf '%s\\n' "$manifest_hash" > ${shellQuote(markerPath)}`,
  ].join("\n")
  const runInstall = () =>
    runDaytonaCommand(sandbox, command, {
      cwd: paths.repoPath,
      env: {
        CODEX_HOME: paths.codexHome,
        CI: "1",
        HOME: paths.home,
        PATH: terminalPath,
        ...presetSecretEnv(input.sandboxPreset?.secrets),
      },
      onStderr: (data) => {
        const trimmed = compactLine(data)
        if (trimmed) void input.onLog?.({ kind: "stderr", message: trimmed })
      },
      onStdout: (data) => {
        const trimmed = compactLine(data)
        if (trimmed) void input.onLog?.({ kind: "stdout", message: trimmed })
      },
      timeoutMs: PRESET_INSTALL_TIMEOUT_MS,
    })

  const result = await runInstall()

  if (result.exitCode !== 0) {
    const outputLines = [result.stderr, result.stdout].flatMap((value) =>
      value
        .split(/\r?\n/)
        .map((line) => compactLine(line, 300))
        .filter(Boolean)
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

async function cleanupRunFiles(sandbox: Sandbox, paths: DaytonaSandboxPaths) {
  await runDaytonaCommand(
    sandbox,
    `rm -f ${shellQuote(`${paths.codexHome}/auth.json`)} ${shellQuote(
      paths.promptPath
    )} ${shellQuote(paths.previousDiffPath)} ${shellQuote(paths.lastMessagePath)}`,
    {
      timeoutMs: 10_000,
    }
  ).catch(() => undefined)
}

async function writeBaseRef(sandbox: Sandbox, paths: DaytonaSandboxPaths) {
  const result = await runDaytonaCommand(
    sandbox,
    `git -C ${shellQuote(paths.repoPath)} rev-parse HEAD`,
    {
      timeoutMs: 10_000,
    }
  )
  await writeDaytonaTextFile(sandbox, paths.baseRefPath, result.stdout.trim())
}

async function repoExists(sandbox: Sandbox, paths: DaytonaSandboxPaths) {
  const result = await runDaytonaCommand(
    sandbox,
    `test -d ${shellQuote(`${paths.repoPath}/.git`)}`,
    { timeoutMs: 10_000 }
  )
  return result.exitCode === 0
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
}: {
  baseBranch?: string
  branchName: string
  githubToken?: string
  input: RunCodexInSandboxInput
  requestedBranchName?: string
  repoUrl: string
  sandbox: Sandbox
  paths: DaytonaSandboxPaths
}) {
  await emitLog(input, {
    detail: baseBranch ? `branch ${baseBranch}` : undefined,
    kind: "command",
    message: `git clone ${repoUrl}`,
  })
  await runDaytonaCommand(
    sandbox,
    `rm -rf ${shellQuote(paths.repoPath)} && mkdir -p ${shellQuote(
      paths.repoPath.replace(/\/[^/]+$/, "")
    )}`,
    { timeoutMs: 60_000 }
  )
  await sandbox.git.clone(
    repoUrl,
    paths.repoPath,
    baseBranch,
    undefined,
    githubToken ? "x-access-token" : undefined,
    githubToken
  )
  if (requestedBranchName) {
    await createBranch(sandbox, input, paths, requestedBranchName)
    return requestedBranchName
  }

  return await createDefaultBranch(sandbox, input, paths, branchName)
}

function helpIncludes(help: string, flag: string) {
  return help.includes(flag)
}

export async function runCodexInSandbox(input: RunCodexInSandboxInput) {
  const model = parseModel(input.model)
  const reasoningEffort = parseReasoningEffort(input.reasoningEffort)
  const repoUrl = parseRepoUrl(input.repoUrl)
  const baseBranch = parseGitRef(input.baseBranch, "baseBranch")
  const requestedBranchName = parseGitRef(input.branchName, "branchName")
  let branchName = requestedBranchName ?? defaultBranchName()
  const githubToken = input.githubToken?.trim() || process.env.GITHUB_TOKEN
  const speed = parseSpeed(input.speed)
  const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  const existingCodexThreadId = parseOpaqueId(
    input.codexThreadId,
    "codexThreadId"
  )

  await emitLog(input, {
    kind: "setup",
    message: input.sandboxId
      ? "Connecting to Daytona sandbox"
      : input.sandboxPreset?.daytonaSnapshot
        ? "Creating Daytona sandbox from preset snapshot"
        : "Creating Daytona sandbox",
  })

  const { recoveredSandbox, sandbox } = await connectOrCreateSandbox(input)
  const paths = await resolveDaytonaPaths(sandbox)

  try {
    await emitLog(input, {
      detail: sandbox.id,
      kind: "setup",
      message: recoveredSandbox
        ? "Recovered with a fresh Daytona sandbox"
        : "Daytona sandbox ready",
    })
    await emitLog(input, {
      detail: sandbox.snapshot,
      kind: "setup",
      message: `Sandbox resources: ${sandbox.cpu} CPU, ${sandbox.memory} GB RAM`,
    })
    await setDaytonaRunAutostop(sandbox, timeoutMs)

    const codexThreadIdToResume = !recoveredSandbox
      ? existingCodexThreadId
      : undefined
    const shouldRestoreConversation = Boolean(
      existingCodexThreadId && !codexThreadIdToResume
    )
    const prompt =
      shouldRestoreConversation && input.resumeContext?.trim()
        ? restoredConversationPrompt(input.resumeContext, input.prompt)
        : input.prompt
    const needsCodexSetup =
      recoveredSandbox ||
      !(await isCodexLauncherReady(sandbox, paths))

    if (needsCodexSetup) {
      await updateCodexCli(sandbox, input, paths)
    }

    await emitLog(input, { kind: "setup", message: "Preparing Codex auth" })
    await runDaytonaCommand(
      sandbox,
      `mkdir -p ${shellQuote(paths.codexHome)} && chmod 700 ${shellQuote(
        paths.codexHome
      )}`,
      { timeoutMs: 10_000 }
    )
    await writeDaytonaTextFile(
      sandbox,
      `${paths.codexHome}/auth.json`,
      input.authJson
    )
    await writeDaytonaTextFile(sandbox, paths.promptPath, prompt)
    await runDaytonaCommand(
      sandbox,
      `chmod 600 ${shellQuote(`${paths.codexHome}/auth.json`)} ${shellQuote(
        paths.promptPath
      )}`,
      { timeoutMs: 10_000 }
    )

    const needsRepoClone = recoveredSandbox || !(await repoExists(sandbox, paths))
    if (needsRepoClone) {
      branchName = await cloneRepo({
        baseBranch,
        branchName,
        githubToken,
        input,
        requestedBranchName,
        repoUrl,
        sandbox,
        paths,
      })
      await writeBaseRef(sandbox, paths)
      if (input.previousDiff?.trim()) {
        await emitLog(input, {
          kind: "command",
          message: "git apply previous changes",
        })
        await writeDaytonaTextFile(
          sandbox,
          paths.previousDiffPath,
          input.previousDiff
        )
        const applyResult = await runDaytonaCommand(
          sandbox,
          `git -C ${shellQuote(
            paths.repoPath
          )} apply --whitespace=nowarn ${shellQuote(paths.previousDiffPath)}`,
          { timeoutMs: 60_000 }
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
    } else {
      await emitLog(input, {
        kind: "command",
        message: `test -d ${paths.repoPath}/.git`,
      })
    }

    await prepareSandboxRuntime(sandbox, input, paths)
    await runPathInstallScript(sandbox, input, paths)
    await runPresetInstallScript(sandbox, input, paths)

    await emitLog(input, {
      kind: "setup",
      message: "Reading Codex CLI capabilities",
    })
    const help = await getCodexExecHelp(sandbox, paths)
    const resumeHelp = codexThreadIdToResume
      ? await getCodexResumeHelp(sandbox, paths)
      : ""
    const modelFlag =
      model && (helpIncludes(help, "--model") || helpIncludes(help, "-m,"))
        ? `--model ${shellQuote(model)}`
        : ""
    const resumeModelFlag =
      model &&
      resumeHelp &&
      (helpIncludes(resumeHelp, "--model") || helpIncludes(resumeHelp, "-m,"))
        ? `--model ${shellQuote(model)}`
        : ""
    const configFlags = [
      reasoningEffort && helpIncludes(help, "--config")
        ? `-c ${shellQuote(`model_reasoning_effort="${reasoningEffort}"`)}`
        : "",
      speed === "fast" && helpIncludes(help, "--config")
        ? `-c ${shellQuote('service_tier="fast"')}`
        : "",
    ]
      .filter(Boolean)
      .join(" ")
    const resumeConfigFlags = [
      reasoningEffort && helpIncludes(resumeHelp, "--config")
        ? `-c ${shellQuote(`model_reasoning_effort="${reasoningEffort}"`)}`
        : "",
      speed === "fast" && helpIncludes(resumeHelp, "--config")
        ? `-c ${shellQuote('service_tier="fast"')}`
        : "",
    ]
      .filter(Boolean)
      .join(" ")
    const optionalFlags = [
      helpIncludes(help, "--dangerously-bypass-approvals-and-sandbox")
        ? "--dangerously-bypass-approvals-and-sandbox"
        : "",
      !helpIncludes(help, "--dangerously-bypass-approvals-and-sandbox") &&
      helpIncludes(help, "--sandbox")
        ? "--sandbox danger-full-access"
        : "",
      helpIncludes(help, "--full-auto") ? "--full-auto" : "",
      helpIncludes(help, "--skip-git-repo-check")
        ? "--skip-git-repo-check"
        : "",
      helpIncludes(help, "--ignore-user-config") ? "--ignore-user-config" : "",
      helpIncludes(help, "--ignore-rules") ? "--ignore-rules" : "",
      helpIncludes(help, "--json") ? "--json" : "",
    ]
      .filter(Boolean)
      .join(" ")
    const resumeOptionalFlags = [
      helpIncludes(resumeHelp, "--dangerously-bypass-approvals-and-sandbox")
        ? "--dangerously-bypass-approvals-and-sandbox"
        : "",
      helpIncludes(resumeHelp, "--full-auto") ? "--full-auto" : "",
      helpIncludes(resumeHelp, "--skip-git-repo-check")
        ? "--skip-git-repo-check"
        : "",
      helpIncludes(resumeHelp, "--ignore-user-config")
        ? "--ignore-user-config"
        : "",
      helpIncludes(resumeHelp, "--ignore-rules") ? "--ignore-rules" : "",
      helpIncludes(resumeHelp, "--json") ? "--json" : "",
    ]
      .filter(Boolean)
      .join(" ")
    const outputFlag = helpIncludes(help, "--output-last-message")
      ? `--output-last-message ${shellQuote(paths.lastMessagePath)}`
      : ""
    const resumeOutputFlag = helpIncludes(resumeHelp, "--output-last-message")
      ? `--output-last-message ${shellQuote(paths.lastMessagePath)}`
      : ""
    const cdFlag =
      helpIncludes(help, "--cd") || helpIncludes(help, "-C,")
        ? `-C ${shellQuote(paths.repoPath)}`
        : ""
    const cdCommand = cdFlag ? "" : `cd ${shellQuote(paths.repoPath)} &&`
    const sandboxPath = daytonaCodexPath(paths)
    const codexCommand = codexThreadIdToResume
      ? [
          `cd ${shellQuote(paths.repoPath)} &&`,
          `HOME=${shellQuote(paths.runtimeHome)}`,
          `CODEX_HOME=${shellQuote(paths.codexHome)}`,
          "BASH_ENV=/dev/null",
          "SHELL=/bin/bash",
          `${shellQuote(paths.codexLauncherPath)} exec resume`,
          resumeOptionalFlags,
          resumeConfigFlags,
          resumeModelFlag,
          resumeOutputFlag,
          shellQuote(codexThreadIdToResume),
          "-",
          `< ${shellQuote(paths.promptPath)}`,
        ]
          .filter(Boolean)
          .join(" ")
      : [
          cdCommand,
          `HOME=${shellQuote(paths.runtimeHome)}`,
          `CODEX_HOME=${shellQuote(paths.codexHome)}`,
          "BASH_ENV=/dev/null",
          "SHELL=/bin/bash",
          `${shellQuote(paths.codexLauncherPath)} exec`,
          optionalFlags,
          configFlags,
          modelFlag,
          outputFlag,
          cdFlag,
          `< ${shellQuote(paths.promptPath)}`,
        ]
          .filter(Boolean)
          .join(" ")
    const command = [
      "set +e",
      `[ -f ${shellQuote(paths.presetEnvPath)} ] && . ${shellQuote(
        paths.presetEnvPath
      )}`,
      `export PATH=${shellQuote(sandboxPath)}`,
      codexCommand,
      "code=$?",
      `printf '\\n${EXIT_MARKER}%s\\n' \"$code\"`,
      "exit 0",
    ].join("\n")

    await emitLog(input, {
      kind: "command",
      message: compactLine(codexCommand),
    })
    let codexThreadId = codexThreadIdToResume
    const stdoutLogger = createStdoutLogger(input.onLog, (threadId) => {
      codexThreadId = threadId
    })
    const result = redactAuthPathOutput(
      await runDaytonaCommand(sandbox, command, {
        cwd: paths.home,
        env: codexShellEnv(paths, input.sandboxPreset?.secrets),
        onStderr: (data) => {
          const trimmed = compactLine(data)
          if (trimmed) void input.onLog?.({ kind: "stderr", message: trimmed })
        },
        onStdout: (data) => stdoutLogger.chunk(data),
        timeoutMs,
      }),
      paths
    )
    stdoutLogger.flush()

    await emitLog(input, {
      detail: String(result.exitCode),
      kind: result.exitCode === 0 ? "setup" : "stderr",
      message: `Codex exited with code ${result.exitCode}`,
    })

    await emitLog(input, {
      kind: "command",
      message: "git diff --binary base",
    })
    const lastMessage = await readLastMessage(sandbox, paths)
    const updatedAuthJson = await readDaytonaTextFile(
      sandbox,
      `${paths.codexHome}/auth.json`
    )
    await cleanupRunFiles(sandbox, paths)

    const target = createSandboxTarget(sandbox, paths)
    const { diff, status } = await withoutCloudcodeEnvLocal(
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
            `base_ref=$(cat ${shellQuote(
              paths.baseRefPath
            )} 2>/dev/null || git -C ${shellQuote(
              paths.repoPath
            )} rev-parse HEAD); git -C ${shellQuote(
              paths.repoPath
            )} add -N . >/dev/null 2>&1 || true; git -C ${shellQuote(
              paths.repoPath
            )} diff --binary "$base_ref"`,
            {
              timeoutMs: 60_000,
            }
          )
        ).stdout
        await emitLog(input, {
          kind: "command",
          message: "git status --short --branch",
        })
        const status = (
          await runDaytonaCommand(
            sandbox,
            `git -C ${shellQuote(paths.repoPath)} status --short --branch`,
            {
              timeoutMs: 60_000,
            }
          )
        ).stdout
        await emitLog(input, {
          kind: "result",
          message:
            result.exitCode === 0
              ? "Codex run completed"
              : `Codex exited with code ${result.exitCode}`,
        })

        return { diff, status }
      }
    )

    return {
      branchName,
      codexThreadId,
      diff,
      exitCode: result.exitCode,
      lastMessage,
      repoUrl,
      sandboxId: sandbox.id,
      stderr: result.stderr,
      status,
      stdout: result.stdout,
      updatedAuthJson,
      recoveredSandbox,
    } satisfies RunCodexInSandboxResult
  } finally {
    try {
      await cleanupRunFiles(sandbox, paths)
    } finally {
      await restoreDaytonaAutostop(sandbox)
    }
  }
}
