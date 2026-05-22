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

export const CODEX_TOOL_MARKER_REGEX = /<codex-tool>([^<]*)<\/codex-tool>/g

const MAX_MARKER_COMMAND_LENGTH = 1_000
const MAX_MARKER_OUTPUT_LENGTH = 1_500
const MAX_MARKER_TEXT_LENGTH = 800

type ToolMarkerDetail = {
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
    return {
      command: truncateMarkerText(value.command, MAX_MARKER_COMMAND_LENGTH),
      exitCode: typeof value.exitCode === "number" ? value.exitCode : undefined,
      kind: value.kind,
      output: truncateMarkerText(value.output, MAX_MARKER_OUTPUT_LENGTH),
      status: truncateMarkerText(value.status, MAX_MARKER_TEXT_LENGTH),
    }
  }

  if (value.kind === "tool_call") {
    return {
      kind: value.kind,
      name: truncateMarkerText(value.name, MAX_MARKER_TEXT_LENGTH),
      status: truncateMarkerText(value.status, MAX_MARKER_TEXT_LENGTH),
      text: truncateMarkerText(value.text, MAX_MARKER_TEXT_LENGTH),
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
