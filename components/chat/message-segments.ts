import { withToolDetailRenderKey } from "@/components/chat/tool-details"
import type { ParsedLogDetail } from "@/components/chat/tool-detail-types"
import type { RecordingVideoArtifact } from "@/components/sandbox/recording-video-utils"

const TOOL_MARKER_REGEX = /<codex-tool>([^<]*)<\/codex-tool>/g
const DAYTONA_RECORDING_PATH_REGEX =
  /\/(?:root|home\/[^/\s]+)\/\.daytona\/recordings\/([0-9a-fA-F-]{36})(?:_[^\s<)]*)?\.mp4/g

type AssistantSegment =
  | { key: string; kind: "text"; text: string }
  | { detail: ParsedLogDetail; key: string; kind: "tool" }

export type AssistantGroupedSegment =
  | { key: string; kind: "text"; text: string }
  | { details: ParsedLogDetail[]; key: string; kind: "tools" }

export type RecordingTextPart =
  | { key: string; kind: "recording"; recording: RecordingVideoArtifact }
  | { key: string; kind: "text"; text: string }

export const EMPTY_TOOL_DETAILS: ParsedLogDetail[] = []

function splitContentByToolMarkers(text: string): AssistantSegment[] {
  const segments: AssistantSegment[] = []
  let last = 0
  let m: RegExpExecArray | null
  TOOL_MARKER_REGEX.lastIndex = 0
  while ((m = TOOL_MARKER_REGEX.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({
        key: `text-${last}-${m.index}`,
        kind: "text",
        text: text.slice(last, m.index),
      })
    }
    try {
      const decoded = decodeURIComponent(m[1])
      const detail = JSON.parse(decoded) as ParsedLogDetail
      const key = `tool-${m.index}`
      segments.push({
        detail: withToolDetailRenderKey(detail, key),
        key,
        kind: "tool",
      })
    } catch {
      // A malformed marker should not drop the surrounding assistant content.
    }
    last = m.index + m[0].length
  }
  if (last < text.length) {
    segments.push({
      key: `text-${last}-${text.length}`,
      kind: "text",
      text: text.slice(last),
    })
  }
  return segments
}

function groupAssistantSegments(
  segments: AssistantSegment[]
): AssistantGroupedSegment[] {
  const grouped: AssistantGroupedSegment[] = []
  let toolBuf: ParsedLogDetail[] = []
  let toolBufKey = ""

  function flushToolBuf() {
    if (toolBuf.length === 0) return
    grouped.push({
      details: toolBuf,
      key: `tools-${toolBufKey}`,
      kind: "tools",
    })
    toolBuf = []
    toolBufKey = ""
  }

  for (const segment of segments) {
    if (segment.kind === "tool") {
      toolBuf.push(segment.detail)
      toolBufKey = toolBufKey ? `${toolBufKey}-${segment.key}` : segment.key
    } else if (segment.text.trim()) {
      flushToolBuf()
      grouped.push(segment)
    }
  }
  flushToolBuf()
  return grouped
}

export function groupAssistantContent(text: string): {
  grouped: AssistantGroupedSegment[]
  hasToolMarkers: boolean
} {
  const segments = splitContentByToolMarkers(text)
  return {
    grouped: groupAssistantSegments(segments),
    hasToolMarkers: segments.some((segment) => segment.kind === "tool"),
  }
}

export function findLastTextSegmentIndex(
  grouped: AssistantGroupedSegment[]
): number {
  for (let index = grouped.length - 1; index >= 0; index -= 1) {
    const segment = grouped[index]
    if (segment.kind === "text" && segment.text.trim()) return index
  }
  return -1
}

export function shouldShowFinalResponseSeparator(
  grouped: AssistantGroupedSegment[],
  lastTextIndex: number
): boolean {
  if (lastTextIndex <= 0) return false
  return grouped
    .slice(0, lastTextIndex)
    .some(
      (segment) =>
        segment.kind === "tools" ||
        (segment.kind === "text" && segment.text.trim())
    )
}

function cleanRecordingText(text: string): string {
  return text
    .replace(/`+\s*$/g, "")
    .replace(/^\s*`+/g, "")
    .replace(/\n\s*\.\s*$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function splitTextWithRecordings(
  text: string,
  sandboxId?: string | null
): RecordingTextPart[] {
  if (!sandboxId) {
    const cleaned = text.trim()
    return cleaned ? [{ key: "text-0", kind: "text", text: cleaned }] : []
  }

  const parts: RecordingTextPart[] = []
  const seen = new Set<string>()
  let last = 0
  let m: RegExpExecArray | null
  DAYTONA_RECORDING_PATH_REGEX.lastIndex = 0
  while ((m = DAYTONA_RECORDING_PATH_REGEX.exec(text)) !== null) {
    let start = m.index
    let end = m.index + m[0].length
    if (text[start - 1] === "`" && text[end] === "`") {
      start -= 1
      end += 1
    }
    const before = cleanRecordingText(text.slice(last, start))
    if (before) {
      parts.push({ key: `text-${last}-${start}`, kind: "text", text: before })
    }
    const id = m[1]
    if (!seen.has(id)) {
      seen.add(id)
      parts.push({
        key: `recording-${id}`,
        kind: "recording",
        recording: { filePath: m[0], id, sandboxId },
      })
    }
    last = end
  }
  const tail = cleanRecordingText(text.slice(last))
  if (tail) parts.push({ key: `text-${last}`, kind: "text", text: tail })
  return parts
}
