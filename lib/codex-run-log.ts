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

const CODEX_TOOL_MARKER_REGEX = /<codex-tool>([^<]*)<\/codex-tool>/g

const MAX_MARKER_COMMAND_LENGTH = 1_000
const MAX_MARKER_PATCH_COMMAND_LENGTH = 12_000
const MAX_MARKER_OUTPUT_LENGTH = 1_500
const MAX_MARKER_TEXT_LENGTH = 800
const MAX_MARKER_FILE_CHANGES = 50
const MAX_MARKER_FILE_DIFF_LENGTH = 12_000

type ToolMarkerFileChange = {
  diff?: string
  kind?: string
  path?: string
}

type ToolMarkerDetail = {
  changes?: ToolMarkerFileChange[]
  command?: string
  exitCode?: number
  kind?: string
  name?: string
  output?: string
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
    const isPatch =
      typeof value.text === "string" &&
      /\*\*\* Begin Patch|\*\*\* (Add|Update|Delete) File:/.test(value.text)
    return {
      kind: value.kind,
      name: truncateMarkerText(value.name, MAX_MARKER_TEXT_LENGTH),
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
  return content.replace(CODEX_TOOL_MARKER_REGEX, "").trim()
}
