export type CodexRunLogKind =
  | "setup"
  | "command"
  | "reasoning"
  | "stdout"
  | "stderr"
  | "result"

export type CodexRunLog = {
  detail?: string
  kind: CodexRunLogKind
  message: string
}

export type StoredCodexRunLog = CodexRunLog & {
  time: number
}

const CODEX_TOOL_MARKER_REGEX = /<codex-tool>([^<]*)<\/codex-tool>/g

const MAX_MARKER_COMMAND_LENGTH = 1_000
const MAX_MARKER_PATCH_COMMAND_LENGTH = 12_000
const MAX_MARKER_OUTPUT_LENGTH = 1_500
const MAX_MARKER_TEXT_LENGTH = 800
const MAX_MARKER_FILE_CHANGES = 50
const MAX_MARKER_FILE_DIFF_LENGTH = 12_000
const NON_PERSISTED_RUN_LOG_MESSAGES = new Set([
  "Codex diff updated",
  "File change",
  "Shell command",
])

type ToolMarkerFileChange = {
  diff?: string
  kind?: string
  path?: string
}

type ToolMarkerDetail = {
  changes?: ToolMarkerFileChange[]
  command?: string
  exitCode?: number
  itemId?: string
  kind?: string
  name?: string
  output?: string
  recording?: {
    fileName?: string
    filePath?: string
    id?: string
    sandboxId?: string
    status?: string
  }
  status?: string
  text?: string
}

function truncateMarkerText(value: unknown, max: number) {
  if (typeof value !== "string" || !value.trim()) return undefined
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function compactToolDetail(value: ToolMarkerDetail): ToolMarkerDetail | null {
  if (value.kind === "command_execution") {
    const isPatch =
      typeof value.command === "string" &&
      /\*\*\* Begin Patch|\*\*\* (Add|Update|Delete) File:/.test(value.command)
    const commandLimit = isPatch
      ? MAX_MARKER_PATCH_COMMAND_LENGTH
      : MAX_MARKER_COMMAND_LENGTH
    return {
      command: truncateMarkerText(value.command, commandLimit),
      exitCode: typeof value.exitCode === "number" ? value.exitCode : undefined,
      kind: value.kind,
      output: truncateMarkerText(value.output, MAX_MARKER_OUTPUT_LENGTH),
      status: truncateMarkerText(value.status, MAX_MARKER_TEXT_LENGTH),
    }
  }

  if (value.kind === "file_change") {
    return {
      changes: Array.isArray(value.changes)
        ? value.changes.slice(0, MAX_MARKER_FILE_CHANGES).flatMap((change) => {
            if (
              !change ||
              typeof change !== "object" ||
              Array.isArray(change)
            ) {
              return []
            }
            return [
              {
                diff: truncateMarkerText(
                  change.diff,
                  MAX_MARKER_FILE_DIFF_LENGTH
                ),
                kind: truncateMarkerText(change.kind, MAX_MARKER_TEXT_LENGTH),
                path: truncateMarkerText(change.path, MAX_MARKER_TEXT_LENGTH),
              },
            ]
          })
        : undefined,
      kind: value.kind,
      status: truncateMarkerText(value.status, MAX_MARKER_TEXT_LENGTH),
    }
  }

  if (value.kind === "tool_call") {
    if (
      !value.name?.trim() &&
      !value.text?.trim() &&
      !value.recording &&
      !value.output?.trim()
    ) {
      return null
    }

    const isPatch =
      typeof value.text === "string" &&
      /\*\*\* Begin Patch|\*\*\* (Add|Update|Delete) File:/.test(value.text)
    const recording =
      value.recording &&
      typeof value.recording === "object" &&
      typeof value.recording.id === "string"
        ? {
            fileName: truncateMarkerText(
              value.recording.fileName,
              MAX_MARKER_TEXT_LENGTH
            ),
            filePath: truncateMarkerText(
              value.recording.filePath,
              MAX_MARKER_TEXT_LENGTH
            ),
            id: truncateMarkerText(value.recording.id, MAX_MARKER_TEXT_LENGTH),
            sandboxId: truncateMarkerText(
              value.recording.sandboxId,
              MAX_MARKER_TEXT_LENGTH
            ),
            status: truncateMarkerText(
              value.recording.status,
              MAX_MARKER_TEXT_LENGTH
            ),
          }
        : undefined
    return {
      itemId: truncateMarkerText(value.itemId, MAX_MARKER_TEXT_LENGTH),
      kind: value.kind,
      name: truncateMarkerText(value.name, MAX_MARKER_TEXT_LENGTH),
      recording,
      status: truncateMarkerText(value.status, MAX_MARKER_TEXT_LENGTH),
      text: truncateMarkerText(
        value.text,
        isPatch ? MAX_MARKER_PATCH_COMMAND_LENGTH : MAX_MARKER_TEXT_LENGTH
      ),
    }
  }

  return null
}

export function inlineToolMarker(log: { kind: string; detail?: string }) {
  if (log.kind !== "command" || !log.detail) return null

  let parsed: ToolMarkerDetail | null = null
  try {
    parsed = JSON.parse(log.detail) as ToolMarkerDetail
  } catch {
    return null
  }

  const detail = parsed ? compactToolDetail(parsed) : null
  if (!detail) return null

  return `\n\n<codex-tool>${encodeURIComponent(JSON.stringify(detail))}</codex-tool>\n\n`
}

export function stripInlineToolMarkers(content: string) {
  CODEX_TOOL_MARKER_REGEX.lastIndex = 0
  return content
    .replace(CODEX_TOOL_MARKER_REGEX, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function extractInlineToolMarkers(content: string) {
  CODEX_TOOL_MARKER_REGEX.lastIndex = 0
  return Array.from(
    content.matchAll(CODEX_TOOL_MARKER_REGEX),
    (match) => match[0]
  )
}

export function shouldPersistRunLog(log: { message: string }) {
  return !NON_PERSISTED_RUN_LOG_MESSAGES.has(log.message)
}
