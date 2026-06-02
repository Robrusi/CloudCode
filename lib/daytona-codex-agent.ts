import { createHash } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import {
  defaultBranchName,
  defaultBranchNameWithSuffix,
  parseBranchMode,
  shuffledCityBranchNames,
} from "./codex-branch-names"
import {
  daytonaDesktopAgentContext,
  installDaytonaDesktopTools,
  stopDaytonaDesktopAgentRecording,
} from "./daytona-desktop"
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
  type DaytonaCommandResult,
  type DaytonaSandboxPaths,
} from "./daytona-sandbox"
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
import { restoreAutoEnvironmentRepoBaseline } from "./sandbox-repo-baseline"

const EXIT_MARKER = "__CLOUDCODE_CODEX_EXIT__"
const CODEX_CAPABILITIES_EXEC_BEGIN = "__CLOUDCODE_EXEC_HELP_BEGIN__"
const CODEX_CAPABILITIES_EXEC_END = "__CLOUDCODE_EXEC_HELP_END__"
const CODEX_CAPABILITIES_RESUME_BEGIN = "__CLOUDCODE_RESUME_HELP_BEGIN__"
const CODEX_CAPABILITIES_RESUME_END = "__CLOUDCODE_RESUME_HELP_END__"
const CODEX_AUTH_CURRENT = "__CLOUDCODE_CODEX_AUTH_CURRENT__"
const CODEX_UPDATE_TIMEOUT_MS = 3 * 60 * 1000
const CODEX_CAPABILITIES_TIMEOUT_MS = 25_000
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
  githubToken?: string
  githubUserEmail?: string
  githubUserName?: string
  githubUsername?: string
  model?: string
  onContentDelta?: (delta: string) => void | Promise<void>
  onLog?: (log: RunCodexLog) => void | Promise<void>
  previousDiff?: string
  prompt: string
  reasoningEffort?: ReasoningEffort
  requireExistingSandbox?: boolean
  resumeContext?: string
  repoUrl: string
  preparedSandboxFresh?: boolean
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

type CodexCliCapabilities = {
  execHelp: string
  resumeHelp: string
}

type RecordingArtifact = {
  fileName?: string
  filePath?: string
  id: string
  sandboxId?: string
  status?: string
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

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function recordingArtifactFromRecord(
  record: Record<string, unknown>
): RecordingArtifact | undefined {
  const id = stringValue(record.id)
  if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) return undefined

  const filePath = stringValue(record.filePath)
  const fileName = stringValue(record.fileName)
  if (
    !filePath?.includes("/.daytona/recordings/") &&
    !fileName?.endsWith(".mp4")
  ) {
    return undefined
  }

  return {
    ...(fileName ? { fileName } : {}),
    ...(filePath ? { filePath } : {}),
    id,
    ...(stringValue(record.sandboxId)
      ? { sandboxId: stringValue(record.sandboxId) }
      : {}),
    ...(stringValue(record.status)
      ? { status: stringValue(record.status) }
      : {}),
  }
}

function findRecordingArtifact(
  value: unknown,
  depth = 0
): RecordingArtifact | undefined {
  if (depth > 6) return undefined

  if (Array.isArray(value)) {
    for (const nested of value) {
      const recording = findRecordingArtifact(nested, depth + 1)
      if (recording) return recording
    }
    return undefined
  }

  const record = objectRecord(value)
  if (!record) return undefined

  const current = recordingArtifactFromRecord(record)
  if (current) return current

  for (const nested of Object.values(record)) {
    const recording = findRecordingArtifact(nested, depth + 1)
    if (recording) return recording
  }

  return undefined
}

function collectStringValues(
  value: unknown,
  keys: readonly string[],
  depth = 0
): string[] {
  if (depth > 6) return []

  if (Array.isArray(value)) {
    return value.flatMap((nested) =>
      collectStringValues(nested, keys, depth + 1)
    )
  }

  const record = objectRecord(value)
  if (!record) return []

  const values: string[] = []
  for (const key of keys) {
    const found = stringValue(record[key])
    if (found) values.push(found)
  }

  for (const nested of Object.values(record)) {
    values.push(...collectStringValues(nested, keys, depth + 1))
  }

  return values
}

function eventTypeText(record: Record<string, unknown>) {
  return collectStringValues(record, ["type", "method"]).join(" ").toLowerCase()
}

function normalizedEventTypeText(type: string) {
  return type.replace(/[\s._/-]+/g, "")
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

  const type = eventTypeText(record)
  const normalizedType = normalizedEventTypeText(type)
  const threadId = findString(record, [
    "thread_id",
    "threadId",
    "conversation_id",
    "conversationId",
  ])

  return normalizedType.includes("threadstarted") ||
    normalizedType.includes("threadcreated") ||
    normalizedType.includes("conversationstarted") ||
    normalizedType.includes("conversationcreated")
    ? threadId
    : undefined
}

function assistantTextFromEvent(event: unknown) {
  const record = objectRecord(event)
  if (!record) return undefined

  const type = eventTypeText(record)
  if (!type) {
    return undefined
  }
  const normalizedType = normalizedEventTypeText(type)
  const isAssistantTextEvent =
    type.includes("assistant") ||
    type.includes("agent_message") ||
    normalizedType.includes("agentmessage") ||
    type.includes("message_delta") ||
    normalizedType.includes("messagedelta") ||
    type.includes("output_text") ||
    normalizedType.includes("outputtext") ||
    type.includes("text_delta") ||
    normalizedType.includes("textdelta")

  if (
    !isAssistantTextEvent ||
    type.includes("reason") ||
    type.includes("tool") ||
    type.includes("user") ||
    normalizedType.includes("commandexecution")
  ) {
    return undefined
  }

  const text = findString(record, ["delta", "text_delta", "content_delta"])
  if (text && isAssistantTextEvent) {
    return { mode: "delta" as const, text }
  }

  const snapshot = findString(record, ["message", "content", "text"])
  if (snapshot && isAssistantTextEvent) {
    return { mode: "snapshot" as const, text: snapshot }
  }

  return undefined
}

function findString(
  value: unknown,
  keys: readonly string[],
  depth = 0
): string | undefined {
  if (Array.isArray(value)) {
    if (depth > 6) return undefined

    const parts = value.flatMap((nested) => {
      const part = findString(nested, keys, depth + 1)
      return part ? [part] : []
    })

    return parts.length ? parts.join(" ") : undefined
  }

  const record = objectRecord(value)
  if (!record || depth > 6) return undefined

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

function findNumber(
  value: unknown,
  keys: readonly string[],
  depth = 0
): number | undefined {
  if (Array.isArray(value)) {
    if (depth > 6) return undefined

    for (const nested of value) {
      const found = findNumber(nested, keys, depth + 1)
      if (found !== undefined) return found
    }

    return undefined
  }

  const record = objectRecord(value)
  if (!record || depth > 6) return undefined

  for (const key of keys) {
    const found = numberValue(record[key])
    if (found !== undefined) return found
  }

  for (const nested of Object.values(record)) {
    const found = findNumber(nested, keys, depth + 1)
    if (found !== undefined) return found
  }

  return undefined
}

type CodexFileChange = {
  diff?: string
  kind: "add" | "delete" | "update"
  path: string
}

function normalizeFileChangeKind(value: string | undefined) {
  if (value === "add" || value === "create") return "add"
  if (value === "delete" || value === "remove") return "delete"
  if (value === "update" || value === "modify" || value === "edit") {
    return "update"
  }
  return undefined
}

function parseFileChange(value: unknown): CodexFileChange | null {
  const record = objectRecord(value)
  if (!record) return null

  const path = stringValue(record.path)
  const kind = normalizeFileChangeKind(
    stringValue(record.kind) ?? stringValue(record.type)
  )
  const diff = findString(record, [
    "unified_diff",
    "unifiedDiff",
    "diff",
    "patch",
    "body",
    "content",
  ])

  return path && kind ? { diff, kind, path } : null
}

function findPatchBody(value: unknown, depth = 0): string | undefined {
  if (depth > 6) return undefined
  if (typeof value === "string") {
    if (
      value.includes("*** Begin Patch") ||
      /\*\*\* (Add|Update|Delete) File:/.test(value)
    ) {
      return value
    }
    // Sometimes a JSON-encoded argument string carries the patch.
    if (value.startsWith("{") || value.startsWith("[")) {
      try {
        return findPatchBody(JSON.parse(value), depth + 1)
      } catch {
        return undefined
      }
    }
    return undefined
  }
  if (Array.isArray(value)) {
    for (const nested of value) {
      const found = findPatchBody(nested, depth + 1)
      if (found) return found
    }
    return undefined
  }
  const record = objectRecord(value)
  if (!record) return undefined
  for (const key of [
    "input",
    "patch",
    "unified_diff",
    "unifiedDiff",
    "diff",
    "body",
    "arguments",
    "args",
  ]) {
    const candidate = record[key]
    const found = findPatchBody(candidate, depth + 1)
    if (found) return found
  }
  for (const nested of Object.values(record)) {
    const found = findPatchBody(nested, depth + 1)
    if (found) return found
  }
  return undefined
}

function extractPatchForPath(
  patchBody: string | undefined,
  path: string
): string | undefined {
  if (!patchBody || !path) return undefined
  // Locate the `*** (Add|Update|Delete) File: <path>` header and grab through
  // the next file header or end-of-patch sentinel.
  const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const fileRegex = new RegExp(
    `\\*\\*\\* (Add|Update|Delete) File:\\s*${escapedPath}[ \\t]*\\n?([\\s\\S]*?)(?=\\n\\*\\*\\* (?:Add|Update|Delete) File:|\\n\\*\\*\\* End Patch|$)`
  )
  const match = patchBody.match(fileRegex)
  if (!match) return undefined
  return `*** ${match[1]} File: ${path}\n${match[2].replace(/\n+$/, "")}`
}

const PATCH_FILE_HEADER_REGEX = /\*\*\* (Add|Update|Delete) File:\s*([^\n]+)/g

function collectPatchFileChanges(patchBody: string | undefined) {
  if (!patchBody) return []

  const changes: CodexFileChange[] = []
  let match: RegExpExecArray | null
  PATCH_FILE_HEADER_REGEX.lastIndex = 0
  while ((match = PATCH_FILE_HEADER_REGEX.exec(patchBody)) !== null) {
    const kind = normalizeFileChangeKind(match[1].toLowerCase())
    const path = match[2].trim()
    if (!kind || !path) continue
    changes.push({
      diff: extractPatchForPath(patchBody, path),
      kind,
      path,
    })
  }
  return changes
}

function mergeFileChanges(
  primary: CodexFileChange[],
  fallback: CodexFileChange[]
) {
  const byKey = new Map<string, CodexFileChange>()
  for (const change of [...primary, ...fallback]) {
    const key = `${change.kind}:${change.path}`
    const existing = byKey.get(key)
    byKey.set(key, existing?.diff ? existing : change)
  }
  return Array.from(byKey.values())
}

function collectFileChanges(value: unknown, depth = 0): CodexFileChange[] {
  if (depth > 6) return []

  if (Array.isArray(value)) {
    return value.flatMap((nested) => collectFileChanges(nested, depth + 1))
  }

  const record = objectRecord(value)
  if (!record) return []

  const changes: CodexFileChange[] = []
  for (const key of ["changes", "file_changes", "fileChanges"]) {
    const nested = record[key]
    if (!Array.isArray(nested)) continue
    changes.push(
      ...nested.flatMap((item) => {
        const change = parseFileChange(item)
        return change ? [change] : []
      })
    )
  }

  for (const nested of Object.values(record)) {
    changes.push(...collectFileChanges(nested, depth + 1))
  }

  return changes
}

function logDetail(value: Record<string, unknown>) {
  return JSON.stringify(value)
}

function summarizeCodexEvent(event: unknown): RunCodexLog | undefined {
  const record = objectRecord(event)
  if (!record) return undefined

  const type = eventTypeText(record)
  const normalizedType = normalizedEventTypeText(type)
  const status = stringValue(record.status)
  const nestedStatus = findString(record, ["status"])
  const command = findString(record, ["command", "cmd", "shell_command"])
  const output = findString(record, ["aggregated_output", "output", "stdout"])
  const exitCode = findNumber(record, ["exit_code", "exitCode"])
  const eventPatch = findPatchBody(record)
  const fileChanges = mergeFileChanges(
    collectFileChanges(record),
    collectPatchFileChanges(eventPatch)
  )
  const toolName = findString(record, [
    "tool",
    "tool_name",
    "name",
    "function_name",
  ])
  const text = findString(record, [
    "summary",
    "message",
    "text",
    "content",
    "delta",
  ])
  const recording = findRecordingArtifact(record)

  if (
    fileChanges.length > 0 &&
    (normalizedType.includes("filechange") ||
      type.includes("tool") ||
      type.includes("function"))
  ) {
    const completeStatus = nestedStatus ?? status
    if (completeStatus === "in_progress") return undefined

    const enriched = fileChanges.map((change) =>
      change.diff
        ? change
        : { ...change, diff: extractPatchForPath(eventPatch, change.path) }
    )

    return {
      detail: logDetail({
        changes: enriched,
        kind: "file_change",
        status: completeStatus,
      }),
      kind: "command",
      message: "File change",
    }
  }

  if (type.includes("reason")) {
    return {
      kind: "reasoning",
      message: text ? compactLine(readableCodexText(text)) : "Reasoning",
    }
  }

  if (
    command &&
    (type.includes("command") ||
      normalizedType.includes("commandexecution") ||
      type.includes("exec") ||
      type.includes("tool") ||
      type.includes("function"))
  ) {
    return {
      detail: logDetail({
        command,
        exitCode,
        kind: "command_execution",
        output,
        status: nestedStatus ?? status,
      }),
      kind: "command",
      message: "Shell command",
    }
  }

  if (
    type.includes("tool") ||
    type.includes("function") ||
    normalizedType.includes("toolcall") ||
    normalizedType.includes("functioncall")
  ) {
    const name = toolName ?? "Tool call"
    return {
      detail: logDetail({
        kind: "tool_call",
        name,
        ...(recording ? { recording } : {}),
        status: nestedStatus ?? status,
        text: text ? readableCodexText(text) : undefined,
      }),
      kind: "command",
      message: name,
    }
  }

  if (type.includes("result")) {
    return {
      detail: status,
      kind: "result",
      message: text ? compactLine(readableCodexText(text)) : "Result",
    }
  }

  if (
    (type.includes("turn") || normalizedType.includes("turn")) &&
    (type.includes("start") || normalizedType.includes("started") || status)
  ) {
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

  const type = eventTypeText(record)
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
  onContentDelta: RunCodexInSandboxInput["onContentDelta"],
  onCodexThreadId: (threadId: string) => void
) {
  let buffer = ""
  let assistantSnapshot = ""

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
      const assistantText = assistantTextFromEvent(event)
      if (assistantText) {
        if (assistantText.mode === "delta") {
          assistantSnapshot += assistantText.text
          void onContentDelta?.(assistantText.text)
        } else if (assistantText.text.startsWith(assistantSnapshot)) {
          const delta = assistantText.text.slice(assistantSnapshot.length)
          assistantSnapshot = assistantText.text
          if (delta) void onContentDelta?.(delta)
        } else if (assistantText.text !== assistantSnapshot) {
          const separator = assistantSnapshot ? "\n\n" : ""
          assistantSnapshot = assistantText.text
          void onContentDelta?.(`${separator}${assistantText.text}`)
        }
        return
      }
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
      if (input.preparedSandboxFresh || input.requireExistingSandbox) {
        return {
          createdSandbox: false,
          recoveredSandbox: false,
          sandbox,
        }
      }

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
      if (input.preparedSandboxFresh || input.requireExistingSandbox) {
        throw new Error("Prepared auto environment sandbox is unavailable.")
      }
      // The DB can outlive an auto-deleted sandbox. Continue in a fresh one.
    }
  }

  return {
    createdSandbox: true,
    recoveredSandbox: Boolean(input.sandboxId),
    sandbox: await createNewSandbox(),
  }
}

async function readLastMessage(sandbox: Sandbox, paths: DaytonaSandboxPaths) {
  try {
    return (await readDaytonaTextFile(sandbox, paths.lastMessagePath)).trim()
  } catch {
    return ""
  }
}

function markerSection(output: string, begin: string, end: string) {
  const start = output.indexOf(begin)
  if (start < 0) return ""
  const contentStart = start + begin.length
  const contentEnd = output.indexOf(end, contentStart)
  if (contentEnd < 0) return ""

  return output.slice(contentStart, contentEnd).replace(/^\r?\n/, "")
}

function codexCapabilitiesCacheCommand(
  paths: DaytonaSandboxPaths,
  includeResume: boolean
) {
  const cacheDir = `${paths.codexHome}/capabilities`
  const versionPath = `${cacheDir}/codex-version`
  const execHelpPath = `${cacheDir}/exec-help.txt`
  const resumeHelpPath = `${cacheDir}/resume-help.txt`
  const execTmpPath = `${cacheDir}/exec-help.tmp`
  const resumeTmpPath = `${cacheDir}/resume-help.tmp`

  return [
    "set -e",
    `mkdir -p ${shellQuote(cacheDir)}`,
    `version="$(${shellQuote(paths.codexLauncherPath)} --version 2>/dev/null | head -1 || true)"`,
    '[ -n "$version" ] || version="unknown"',
    "refresh=0",
    `[ -f ${shellQuote(versionPath)} ] && grep -qxF -- "$version" ${shellQuote(versionPath)} || refresh=1`,
    `[ -s ${shellQuote(execHelpPath)} ] || refresh=1`,
    includeResume ? `[ -s ${shellQuote(resumeHelpPath)} ] || refresh=1` : "",
    'if [ "$refresh" = "1" ]; then',
    `  if ! ${shellQuote(paths.codexLauncherPath)} exec --help > ${shellQuote(execTmpPath)} 2>/dev/null; then : > ${shellQuote(execTmpPath)}; fi`,
    includeResume
      ? `  if ! ${shellQuote(paths.codexLauncherPath)} exec resume --help > ${shellQuote(resumeTmpPath)} 2>/dev/null; then : > ${shellQuote(resumeTmpPath)}; fi`
      : `  rm -f ${shellQuote(resumeTmpPath)} ${shellQuote(resumeHelpPath)}`,
    `  mv ${shellQuote(execTmpPath)} ${shellQuote(execHelpPath)}`,
    includeResume
      ? `  mv ${shellQuote(resumeTmpPath)} ${shellQuote(resumeHelpPath)}`
      : "",
    `  printf '%s\\n' "$version" > ${shellQuote(versionPath)}`,
    "fi",
    `printf '%s\\n' ${shellQuote(CODEX_CAPABILITIES_EXEC_BEGIN)}`,
    `cat ${shellQuote(execHelpPath)} 2>/dev/null || true`,
    `printf '%s\\n' ${shellQuote(CODEX_CAPABILITIES_EXEC_END)}`,
    `printf '%s\\n' ${shellQuote(CODEX_CAPABILITIES_RESUME_BEGIN)}`,
    `cat ${shellQuote(resumeHelpPath)} 2>/dev/null || true`,
    `printf '%s\\n' ${shellQuote(CODEX_CAPABILITIES_RESUME_END)}`,
  ]
    .filter(Boolean)
    .join("\n")
}

async function getCodexCliCapabilities({
  includeResume,
  paths,
  sandbox,
}: {
  includeResume: boolean
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
}): Promise<CodexCliCapabilities> {
  try {
    const result = await runDaytonaCommand(
      sandbox,
      codexCapabilitiesCacheCommand(paths, includeResume),
      {
        cwd: paths.home,
        env: codexShellEnv(paths),
        timeoutMs: CODEX_CAPABILITIES_TIMEOUT_MS,
      }
    )

    if (result.exitCode !== 0) return { execHelp: "", resumeHelp: "" }

    return {
      execHelp: markerSection(
        result.stdout,
        CODEX_CAPABILITIES_EXEC_BEGIN,
        CODEX_CAPABILITIES_EXEC_END
      ),
      resumeHelp: markerSection(
        result.stdout,
        CODEX_CAPABILITIES_RESUME_BEGIN,
        CODEX_CAPABILITIES_RESUME_END
      ),
    }
  } catch {
    return { execHelp: "", resumeHelp: "" }
  }
}

async function isCodexLauncherReady(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  try {
    const result = await runDaytonaCommand(
      sandbox,
      `test -x ${shellQuote(paths.codexLauncherPath)}`,
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

function codexAuthMarkerPath(paths: DaytonaSandboxPaths) {
  return `${paths.codexHome}/auth.sha256`
}

async function prepareCodexAuthAndPrompt({
  authJson,
  paths,
  prompt,
  sandbox,
  signal,
}: {
  authJson: string
  paths: DaytonaSandboxPaths
  prompt: string
  sandbox: Sandbox
  signal?: AbortSignal
}) {
  const authHash = sha256(authJson)
  const authPath = `${paths.codexHome}/auth.json`
  const authMarkerPath = codexAuthMarkerPath(paths)
  const authState = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `mkdir -p ${shellQuote(paths.codexHome)}`,
      `chmod 700 ${shellQuote(paths.codexHome)}`,
      `auth_hash=${shellQuote(authHash)}`,
      `if [ -s ${shellQuote(authPath)} ] && grep -qxF -- "$auth_hash" ${shellQuote(authMarkerPath)} 2>/dev/null; then`,
      `  printf '%s\\n' ${shellQuote(CODEX_AUTH_CURRENT)}`,
      "fi",
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  )

  if (authState.exitCode !== 0) {
    throw new Error(
      compactLine(authState.stderr || authState.stdout) ||
        "Unable to prepare Codex auth directory."
    )
  }

  const authCurrent = authState.stdout.includes(CODEX_AUTH_CURRENT)
  await Promise.all([
    authCurrent
      ? Promise.resolve()
      : writeDaytonaTextFile(sandbox, authPath, authJson),
    writeDaytonaTextFile(sandbox, paths.promptPath, prompt),
  ])

  const chmodResult = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `chmod 600 ${shellQuote(paths.promptPath)} ${shellQuote(authPath)}`,
      authCurrent
        ? ""
        : [
            `printf '%s\\n' ${shellQuote(authHash)} > ${shellQuote(authMarkerPath)}`,
            `chmod 600 ${shellQuote(authMarkerPath)}`,
          ].join("\n"),
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  )

  if (chmodResult.exitCode !== 0) {
    throw new Error(
      compactLine(chmodResult.stderr || chmodResult.stdout) ||
        "Unable to prepare Codex auth files."
    )
  }
}

async function writeCodexAuthMarker(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  authJson: string
) {
  await writeDaytonaTextFile(
    sandbox,
    codexAuthMarkerPath(paths),
    `${sha256(authJson)}\n`
  ).catch(() => undefined)
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
    `rm -f ${shellQuote(paths.promptPath)} ${shellQuote(
      paths.previousDiffPath
    )} ${shellQuote(paths.lastMessagePath)}`,
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
  cloudcodeYaml,
  gitAuth,
  input,
  paths,
  requestedBranchName,
  restoreAutoEnvironmentBaseline,
  sandbox,
  useBaseBranch,
}: {
  baseBranch?: string
  branchName: string
  cloudcodeYaml?: string
  gitAuth?: SandboxGitHubAuth | null
  input: RunCodexInSandboxInput
  paths: DaytonaSandboxPaths
  requestedBranchName?: string
  restoreAutoEnvironmentBaseline?: boolean
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
  } else if (restoreAutoEnvironmentBaseline) {
    await restoreAutoEnvironmentRepoBaseline({
      cloudcodeYaml,
      paths,
      sandbox,
      signal: input.signal,
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

function helpIncludes(help: string, flag: string) {
  return help.includes(flag)
}

function isAutoEnvironmentRun(input: RunCodexInSandboxInput) {
  return input.sandboxPreset?.mode === "auto"
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
        ? input.preparedSandboxFresh
          ? "Connecting to prepared Daytona sandbox"
          : "Connecting to Daytona sandbox"
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

      await emitLog(input, {
        detail: logDetail({
          kind: "tool_call",
          name: "desktop_record_stop",
          recording,
          status: "completed",
          text: `Daytona desktop recording stopped: ${recording.filePath || recording.fileName || recording.id}`,
        }),
        kind: "command",
        message: "Daytona desktop recording stopped",
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
    const repoAlreadyExistsPromise = repoExists(sandbox, paths)

    await emitLog(input, {
      detail: sandbox.snapshot,
      kind: "setup",
      message: `Sandbox resources: ${sandbox.cpu} CPU, ${sandbox.memory} GB RAM`,
    })

    const codexThreadIdToResume = !recoveredSandbox
      ? existingCodexThreadId
      : undefined
    const shouldRestoreConversation = Boolean(
      existingCodexThreadId && !codexThreadIdToResume
    )
    const taskPrompt =
      shouldRestoreConversation && input.resumeContext?.trim()
        ? restoredConversationPrompt(input.resumeContext, input.prompt)
        : input.prompt
    const contextBlocks = [
      cloudcodeYamlAgentContext(input.sandboxPreset?.cloudcodeYaml),
      daytonaDesktopAgentContext(),
    ].filter((value): value is string => Boolean(value))
    const prompt = contextBlocks.length
      ? [...contextBlocks, "Current user request:", taskPrompt].join("\n\n")
      : taskPrompt
    const needsCodexSetup =
      recoveredSandbox ||
      !(await isCodexLauncherReady(sandbox, paths, input.signal))

    if (needsCodexSetup) {
      await updateCodexCli(sandbox, input, paths)
    }

    await Promise.all([
      emitLog(input, { kind: "setup", message: "Preparing Codex auth" }),
      prepareCodexAuthAndPrompt({
        authJson: input.authJson,
        paths,
        prompt,
        sandbox,
        signal: input.signal,
      }),
    ])

    const repoAlreadyExists = await repoAlreadyExistsPromise
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
      await configureSandboxGitHubRemote({
        auth: gitAuth,
        paths,
        sandbox,
        signal: input.signal,
      })
      await trustRepoMiseConfig(sandbox, input, paths)
      const shouldPrepareFreshRepo =
        createdSandbox ||
        input.preparedSandboxFresh ||
        (isAutoEnvironmentRun(input) && !input.requireExistingSandbox)
      if (shouldPrepareFreshRepo) {
        branchName = await prepareExistingRepoForFreshRun({
          baseBranch,
          branchName,
          cloudcodeYaml: input.sandboxPreset?.cloudcodeYaml,
          gitAuth,
          input,
          paths,
          requestedBranchName,
          restoreAutoEnvironmentBaseline: isAutoEnvironmentRun(input),
          sandbox,
          useBaseBranch,
        })
        await writeBaseRef(sandbox, paths)
        preparedFreshRepo = true
      }
    }
    if (repoAlreadyExists && !preparedFreshRepo) {
      await emitLog(input, {
        kind: "command",
        message: `test -d ${paths.repoPath}/.git`,
      })
      // No branch was created this run, so report the branch HEAD is actually on
      // rather than the generated fallback. Matters most for "base" mode, where
      // the work stays on the base branch across continuations.
      const currentBranch = await readSandboxHeadBranch(sandbox, input, paths)
      if (currentBranch) branchName = currentBranch
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

    const { execHelp: help, resumeHelp } = await prepareSandboxRuntime(
      sandbox,
      input,
      paths
    )
      .then(() => installDaytonaDesktopTools(sandbox, paths, input.signal))
      .then(() => runPathInstallScript(sandbox, input, paths, gitAuth))
      .then(() => runPresetInstallScript(sandbox, input, paths, gitAuth))
      .then(() =>
        Promise.all([
          getCodexCliCapabilities({
            includeResume: Boolean(codexThreadIdToResume),
            paths,
            sandbox,
          }),
          emitLog(input, {
            kind: "setup",
            message: "Reading Codex CLI capabilities",
          }),
        ]).then(([capabilities]) => capabilities)
      )
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
          `MISE_TRUSTED_CONFIG_PATHS=${shellQuote(paths.repoPath)}`,
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
          `MISE_TRUSTED_CONFIG_PATHS=${shellQuote(paths.repoPath)}`,
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
      `export MISE_TRUSTED_CONFIG_PATHS=${shellQuote(paths.repoPath)}`,
      codexCommand,
      "code=$?",
      `printf '\\n${EXIT_MARKER}%s\\n' "$code"`,
      "exit 0",
    ].join("\n")

    await emitLog(input, {
      kind: "command",
      message: compactLine(codexCommand),
    })
    let codexThreadId = codexThreadIdToResume
    const stdoutLogger = createStdoutLogger(
      input.onLog,
      input.onContentDelta,
      (threadId) => {
        codexThreadId = threadId
      }
    )
    const result = redactAuthPathOutput(
      await runDaytonaCommand(sandbox, command, {
        cwd: paths.home,
        env: codexShellEnv(paths, input.sandboxPreset?.secrets, gitAuth?.env),
        onStderr: (data) => {
          const trimmed = compactLine(data)
          if (trimmed) void input.onLog?.({ kind: "stderr", message: trimmed })
        },
        onStdout: (data) => stdoutLogger.chunk(data),
        signal: input.signal,
      }),
      paths
    )
    stdoutLogger.flush()
    await stopDesktopAgentRecording()

    const [, runArtifacts] = await Promise.all([
      Promise.all([
        emitLog(input, {
          detail: String(result.exitCode),
          kind: result.exitCode === 0 ? "setup" : "stderr",
          message: `Codex exited with code ${result.exitCode}`,
        }),
        emitLog(input, {
          kind: "command",
          message: "git diff --binary base",
        }),
      ]),
      Promise.all([
        readLastMessage(sandbox, paths),
        readDaytonaTextFile(sandbox, `${paths.codexHome}/auth.json`),
      ]).then(async ([lastMessage, updatedAuthJson]) => {
        await cleanupRunFiles(sandbox, paths, input.signal)
        await writeCodexAuthMarker(sandbox, paths, updatedAuthJson)
        return { lastMessage, updatedAuthJson }
      }),
    ])
    const { lastMessage, updatedAuthJson } = runArtifacts

    const target = createSandboxTarget(sandbox, paths, input.signal)
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
        const [status] = await Promise.all([
          runDaytonaCommand(
            sandbox,
            `git -C ${shellQuote(paths.repoPath)} status --short --branch`,
            {
              env: repoCommandEnv(paths, gitAuth?.env),
              signal: input.signal,
              timeoutMs: 60_000,
            }
          ).then((result) => result.stdout),
          emitLog(input, {
            kind: "command",
            message: "git status --short --branch",
          }),
        ])
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
    stopDaytonaActivityHeartbeat?.()
    await stopDesktopAgentRecording()
    await Promise.all([
      cleanupRunFiles(sandbox, paths, input.signal),
      gitAuth?.cleanup() ?? Promise.resolve(),
    ])
  }
}
