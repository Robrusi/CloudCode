import {
  extractFileOps,
  type FileOp,
} from "@/components/chat/tool-detail-files"
import {
  classifyDetail,
  inferCommandIntent,
  unwrapShellCommand,
  type DetailKind,
} from "@/components/chat/tool-detail-classify"
import type {
  ParsedLogDetail,
  ToolDetailLog,
} from "@/components/chat/tool-detail-types"
import { recordingLabel } from "@/components/sandbox/recording-video-utils"

function parseLogDetail(detail?: string): ParsedLogDetail | null {
  if (!detail) return null
  try {
    const parsed = JSON.parse(detail) as unknown
    return parsed && typeof parsed === "object"
      ? (parsed as ParsedLogDetail)
      : null
  } catch {
    return null
  }
}

export function toolDetailsFromLogs(logs: ToolDetailLog[]) {
  return logs
    .map((log) => {
      const detail = log.kind === "command" ? parseLogDetail(log.detail) : null
      return detail ? withToolDetailRenderKey(detail, log.id) : null
    })
    .filter(
      (detail): detail is ParsedLogDetail =>
        detail?.kind === "command_execution" ||
        detail?.kind === "file_change" ||
        detail?.kind === "tool_call"
    )
}

export function withToolDetailRenderKey(
  detail: ParsedLogDetail,
  renderKey: string
): ParsedLogDetail {
  return { ...detail, renderKey }
}

export function toolDetailKey(detail: ParsedLogDetail) {
  return [
    detail.kind,
    detail.itemId,
    detail.name,
    detail.status,
    detail.exitCode,
    detail.command,
    detail.changes
      ?.map((change) => `${change.kind ?? ""}:${change.path ?? ""}`)
      .join(","),
    detail.recording
      ? `${detail.recording.sandboxId ?? ""}:${detail.recording.id}`
      : undefined,
    detail.text,
    detail.output,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(":")
}

export function toolDetailRenderKey(detail: ParsedLogDetail, fallback: string) {
  return detail.renderKey || fallback
}

export type ToolUmbrella = "explore" | "modify"

function umbrellaForDetail(detail: ParsedLogDetail): ToolUmbrella {
  if (extractFileOps(detail).length > 0) return "modify"
  if (detail.kind === "file_change") return "modify"
  if (detail.kind === "command_execution") return "explore"
  const lower = (detail.name || "").toLowerCase()
  if (/edit|patch|write|create|update|apply|insert/.test(lower)) return "modify"
  return "explore"
}

export function bundleByUmbrella(
  details: ParsedLogDetail[]
): Array<{ umbrella: ToolUmbrella; items: ParsedLogDetail[] }> {
  const bundles: Array<{ umbrella: ToolUmbrella; items: ParsedLogDetail[] }> =
    []
  for (const detail of details) {
    const umbrella = umbrellaForDetail(detail)
    const last = bundles[bundles.length - 1]
    if (last && last.umbrella === umbrella) last.items.push(detail)
    else bundles.push({ umbrella, items: [detail] })
  }
  return bundles
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function summarizeBundle(
  umbrella: ToolUmbrella,
  items: ParsedLogDetail[]
): string {
  const counts: Record<DetailKind, number> = {
    command: 0,
    create: 0,
    edit: 0,
    other: 0,
    read: 0,
    search: 0,
  }
  for (const item of items) {
    const ops = extractFileOps(item)
    if (ops.length > 0) {
      for (const op of ops) {
        if (op.op === "add") counts.create += 1
        else counts.edit += 1
      }
    } else {
      counts[classifyDetail(item)] += 1
    }
  }

  if (umbrella === "modify") {
    const allOps = items.flatMap((item) => extractFileOps(item))
    if (allOps.length === 1) {
      const op = allOps[0]
      const verb =
        op.op === "add" ? "Created" : op.op === "delete" ? "Deleted" : "Edited"
      return `${verb} ${basename(op.path)}`
    }
    const parts: string[] = []
    if (counts.create > 0)
      parts.push(`Created ${pluralize(counts.create, "file", "files")}`)
    if (counts.edit > 0) {
      const verb = parts.length === 0 ? "Edited" : "edited"
      parts.push(`${verb} ${pluralize(counts.edit, "file", "files")}`)
    }
    if (parts.length === 0) return "Made changes"
    return parts.join(", ")
  }

  const parts: string[] = []
  if (counts.read > 0)
    parts.push(`Explored ${pluralize(counts.read, "file", "files")}`)
  if (counts.search > 0) {
    const verb = parts.length === 0 ? "" : ""
    parts.push(`${verb}${pluralize(counts.search, "search", "searches")}`)
  }
  if (counts.command > 0) {
    parts.push(`ran ${pluralize(counts.command, "command", "commands")}`)
  }

  if (parts.length === 0) return "Ran command"

  // Commands-only bundle: use the per-command label form.
  if (counts.read === 0 && counts.search === 0 && counts.command > 0) {
    if (counts.command === 1) {
      const cmd = unwrapShellCommand(
        items.find((i) => i.kind === "command_execution")?.command?.trim() ?? ""
      )
      const first = cmd.split(/\s+/).slice(0, 3).join(" ")
      return first ? `Ran ${first}` : "Ran command"
    }
    return `Ran ${counts.command} commands`
  }

  return parts.join(", ")
}

export function describeItem(detail: ParsedLogDetail): string {
  if (detail.recording) {
    const status = detail.recording.status?.toLowerCase()
    return status === "completed" || status === "stopped"
      ? `Recorded ${recordingLabel(detail.recording)}`
      : `Recording ${recordingLabel(detail.recording)}`
  }

  const kind = classifyDetail(detail)
  const text = detail.text?.trim() ?? ""
  if (kind === "edit" || kind === "create") {
    const ops = extractFileOps(detail)
    if (ops.length === 1) {
      const op = ops[0]
      const verb =
        op.op === "add" ? "Created" : op.op === "delete" ? "Deleted" : "Edited"
      return `${verb} ${basename(op.path)}`
    }
    if (ops.length > 1) {
      const adds = ops.filter((o) => o.op === "add").length
      const others = ops.length - adds
      const parts: string[] = []
      if (adds > 0) parts.push(`Created ${pluralize(adds, "file", "files")}`)
      if (others > 0) {
        const verb = parts.length === 0 ? "Edited" : "edited"
        parts.push(`${verb} ${pluralize(others, "file", "files")}`)
      }
      return parts.join(", ")
    }
    return kind === "create" ? "Created file" : "Edited file"
  }
  if (detail.kind === "command_execution") {
    const cmd = unwrapShellCommand(detail.command?.trim() ?? "")
    const intent = inferCommandIntent(cmd)
    if (intent.kind === "read") return `Read ${basename(intent.target)}`
    if (intent.kind === "search") return `Searched for ${intent.query}`
    const oneLine = cmd.split(/\n/)[0].trim()
    return `Ran ${oneLine || detail.name || "command"}`
  }
  if (kind === "read") {
    const path = text.split(/\s+/)[0]
    return `Read ${basename(path) || text || detail.name || "file"}`
  }
  if (kind === "search") {
    const inMatch = text.match(/^(.+?)\s+in\s+(.+)$/)
    if (inMatch) return `Searched for ${inMatch[1]} in ${inMatch[2]}`
    return text ? `Searched for ${text}` : "Searched"
  }
  return detail.name || "Tool"
}

export function describeFileOp(op: FileOp): string {
  const verb =
    op.op === "add" ? "Created" : op.op === "delete" ? "Deleted" : "Edited"
  return `${verb} ${basename(op.path)}`
}

function basename(path: string): string {
  if (!path) return ""
  const trimmed = path.replace(/\/+$/, "")
  const idx = trimmed.lastIndexOf("/")
  return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}
