"use client"

import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  ScrollText,
  Search,
  SquareTerminal,
  Terminal,
} from "lucide-react"
import { memo, useMemo, useState } from "react"

import { ChangedFiles, DiffList } from "@/components/changed-files"
import { Markdown } from "@/components/chat-markdown"
import { CodeBlock } from "@/components/code-block"
import { cn } from "@/lib/utils"

export type ChatMessage = {
  content: string
  error?: boolean
  id?: string
  meta?: {
    branch?: string
    diff?: string
    logs?: Omit<ChatRunLog, "id">[]
  }
  pending?: boolean
  role: "user" | "assistant"
}

export type ChatRunLog = {
  detail?: string
  id: string
  kind: "setup" | "command" | "reasoning" | "stdout" | "stderr" | "result"
  message: string
  time: number
}

export const MessageBlock = memo(function MessageBlock({
  message,
  onOpenFile,
  onOpenFileDiff,
  repoName,
}: {
  message: ChatMessage
  onOpenFile: (path: string) => void
  onOpenFileDiff: (path: string, diff: string) => void
  repoName: string | null
}) {
  const logs = useMemo(
    () =>
      message.meta?.logs?.map((log, index) => ({
        ...log,
        id: `${message.id ?? "message"}-${log.time}-${index}`,
      })) ?? [],
    [message.id, message.meta?.logs]
  )

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 text-[15px] leading-6 break-words whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  const contentStarted = Boolean(message.content.trim())
  const showSetup = message.pending || logs.length > 0

  return (
    <div className="space-y-3">
      {showSetup ? (
        <RunSetupSummary
          contentStarted={contentStarted}
          logs={logs}
          pending={Boolean(message.pending)}
        />
      ) : null}
      {!message.pending || message.content.trim() ? (
        <AssistantBody
          text={message.content}
          repoName={repoName}
          onOpenFile={onOpenFile}
          error={Boolean(message.error)}
          pending={Boolean(message.pending)}
          logs={logs}
          runDiff={message.meta?.diff}
        />
      ) : null}
      {!message.pending && message.meta?.diff ? (
        <ChangedFiles
          diff={message.meta.diff}
          onOpenDiff={(path) => onOpenFileDiff(path, message.meta!.diff!)}
        />
      ) : null}
      {message.meta?.branch ? (
        <div className="font-mono text-[11px] text-muted-foreground">
          ↳ {message.meta.branch}
        </div>
      ) : null}
    </div>
  )
})

const TOOL_MARKER_REGEX = /<codex-tool>([^<]*)<\/codex-tool>/g

type AssistantSegment =
  | { key: string; kind: "text"; text: string }
  | { detail: ParsedLogDetail; key: string; kind: "tool" }

const EMPTY_TOOL_DETAILS: ParsedLogDetail[] = []

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
      segments.push({ detail, key: `tool-${m.index}`, kind: "tool" })
    } catch {
      // ignore malformed marker
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

const AssistantBody = memo(function AssistantBody({
  text,
  repoName,
  onOpenFile,
  error,
  pending,
  logs,
  runDiff,
}: {
  text: string
  repoName: string | null
  onOpenFile: (path: string) => void
  error: boolean
  pending: boolean
  logs: ChatRunLog[]
  runDiff?: string
}) {
  if (pending) {
    return (
      <PendingAssistantBody
        text={text}
        error={error}
        repoName={repoName}
        onOpenFile={onOpenFile}
        logs={logs}
        runDiff={runDiff}
      />
    )
  }

  const segments = splitContentByToolMarkers(text)
  const hasMarkers = segments.some((segment) => segment.kind === "tool")
  const fallbackTools = hasMarkers ? [] : toolDetailsFromLogs(logs)

  const grouped: Array<
    | { key: string; kind: "text"; text: string }
    | { details: ParsedLogDetail[]; key: string; kind: "tools" }
  > = []
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
  for (const seg of segments) {
    if (seg.kind === "tool") {
      toolBuf.push(seg.detail)
      toolBufKey = toolBufKey ? `${toolBufKey}-${seg.key}` : seg.key
    } else if (seg.text.trim()) {
      flushToolBuf()
      grouped.push(seg)
    }
  }
  flushToolBuf()
  if (fallbackTools.length > 0) {
    grouped.push({
      details: fallbackTools,
      key: "fallback-tools",
      kind: "tools",
    })
  }

  let lastTextIndex = -1
  for (let i = grouped.length - 1; i >= 0; i--) {
    const seg = grouped[i]
    if (seg.kind === "text" && seg.text.trim()) {
      lastTextIndex = i
      break
    }
  }
  const hasEarlierContent = grouped
    .slice(0, lastTextIndex)
    .some(
      (seg) => seg.kind === "tools" || (seg.kind === "text" && seg.text.trim())
    )
  const showFinalSeparator = lastTextIndex > 0 && hasEarlierContent

  const rendered: React.ReactNode[] = []
  grouped.forEach((seg, i) => {
    if (showFinalSeparator && i === lastTextIndex) {
      rendered.push(
        <div key={`sep-${seg.key}`} className="flex items-center gap-4 py-4">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] font-medium tracking-wider text-muted-foreground/60 uppercase">
            Response
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )
    }
    if (seg.kind === "tools") {
      rendered.push(
        <ToolGroup key={seg.key} details={seg.details} runDiff={runDiff} />
      )
    } else if (seg.text.trim()) {
      rendered.push(
        <Markdown
          key={seg.key}
          text={seg.text}
          className={cn("text-[15px] leading-7", error && "text-destructive")}
          repoName={repoName}
          onOpenFile={onOpenFile}
        />
      )
    }
  })

  return <div className="space-y-3">{rendered}</div>
})

const PendingAssistantBody = memo(function PendingAssistantBody({
  text,
  error,
  repoName,
  onOpenFile,
  logs,
  runDiff,
}: {
  text: string
  error: boolean
  repoName: string | null
  onOpenFile: (path: string) => void
  logs: ChatRunLog[]
  runDiff?: string
}) {
  const segments = splitContentByToolMarkers(text)
  const hasMarkers = segments.some((segment) => segment.kind === "tool")
  const fallbackTools = hasMarkers
    ? EMPTY_TOOL_DETAILS
    : toolDetailsFromLogs(logs)

  const grouped: Array<
    | { key: string; kind: "text"; text: string }
    | { details: ParsedLogDetail[]; key: string; kind: "tools" }
  > = []
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
  for (const seg of segments) {
    if (seg.kind === "tool") {
      toolBuf.push(seg.detail)
      toolBufKey = toolBufKey ? `${toolBufKey}-${seg.key}` : seg.key
    } else if (seg.text.trim()) {
      flushToolBuf()
      grouped.push(seg)
    }
  }
  flushToolBuf()

  return (
    <div className="space-y-3">
      {grouped.map((seg) =>
        seg.kind === "tools" ? (
          <ToolGroup key={seg.key} details={seg.details} runDiff={runDiff} />
        ) : (
          <Markdown
            key={seg.key}
            text={seg.text}
            className={cn("text-[15px] leading-7", error && "text-destructive")}
            repoName={repoName}
            onOpenFile={onOpenFile}
          />
        )
      )}
      {fallbackTools.length > 0 ? (
        <ToolGroup details={fallbackTools} runDiff={runDiff} />
      ) : null}
    </div>
  )
})

const RunSetupSummary = memo(function RunSetupSummary({
  contentStarted,
  logs,
  pending,
}: {
  contentStarted: boolean
  logs: ChatRunLog[]
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const setupLogs = logs.filter(isSetupSummaryLog)
  const current = logs.at(-1)
  const expanded = pending && !contentStarted ? true : open

  if (!pending && setupLogs.length === 0) return null

  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md text-left transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            expanded && "rotate-90"
          )}
        />
        {pending && !contentStarted ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        ) : null}
        <span className="truncate text-[13px]">
          {pending
            ? (current?.message ??
              (contentStarted ? "Working..." : "Starting Codex run"))
            : contentStarted
              ? "Setup complete"
              : (current?.message ?? "Starting Codex run")}
        </span>
      </button>

      {expanded && setupLogs.length > 0 ? (
        <div className="space-y-1 border-l border-border/70 pl-3">
          {setupLogs.map((log) => (
            <SetupLogRow key={log.id} log={log} />
          ))}
        </div>
      ) : null}
    </div>
  )
})

function isSetupSummaryLog(log: ChatRunLog) {
  return (
    log.kind === "setup" ||
    log.kind === "command" ||
    log.kind === "stdout" ||
    log.kind === "stderr" ||
    log.kind === "result"
  )
}

type ParsedLogDetail = {
  changes?: Array<{
    diff?: string
    kind?: string
    path?: string
  }>
  command?: string
  exitCode?: number
  kind?: string
  name?: string
  output?: string
  status?: string
  text?: string
}

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

function toolDetailsFromLogs(logs: ChatRunLog[]) {
  return logs
    .map((log) => (log.kind === "command" ? parseLogDetail(log.detail) : null))
    .filter(
      (detail): detail is ParsedLogDetail =>
        detail?.kind === "command_execution" ||
        detail?.kind === "file_change" ||
        detail?.kind === "tool_call"
    )
}

function toolDetailKey(detail: ParsedLogDetail) {
  return [
    detail.kind,
    detail.name,
    detail.status,
    detail.exitCode,
    detail.command,
    detail.changes
      ?.map((change) => `${change.kind ?? ""}:${change.path ?? ""}`)
      .join(","),
    detail.text,
    detail.output,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(":")
}

function normalizeCommandKey(detail: ParsedLogDetail): string | null {
  if (detail.kind !== "command_execution") return null
  const command = detail.command?.trim()
  return command ? unwrapShellCommand(command) : null
}

function normalizedStatus(detail: ParsedLogDetail): string {
  return (
    detail.status
      ?.trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_") ?? ""
  )
}

function isStartLikeCommandDetail(detail: ParsedLogDetail): boolean {
  if (detail.kind !== "command_execution") return false
  const status = normalizedStatus(detail)
  return (
    status === "in_progress" ||
    status === "running" ||
    status === "started" ||
    status === "pending" ||
    status === "executing"
  )
}

function isTerminalCommandDetail(detail: ParsedLogDetail): boolean {
  if (detail.kind !== "command_execution") return false
  const status = normalizedStatus(detail)
  return (
    status === "completed" ||
    status === "complete" ||
    status === "succeeded" ||
    status === "success" ||
    status === "failed" ||
    status === "error" ||
    status === "cancelled" ||
    status === "canceled"
  )
}

function commandDetailCompleteness(detail: ParsedLogDetail): number {
  let score = 0
  if (detail.output?.trim()) score += 4
  if (typeof detail.exitCode === "number") score += 2
  if (isTerminalCommandDetail(detail)) score += 1
  if (isStartLikeCommandDetail(detail)) score -= 1
  return score
}

function shouldMergeCommandDetails(
  previous: ParsedLogDetail | undefined,
  next: ParsedLogDetail
): previous is ParsedLogDetail {
  if (!previous) return false
  const previousKey = normalizeCommandKey(previous)
  const nextKey = normalizeCommandKey(next)
  if (!previousKey || previousKey !== nextKey) return false

  if (isStartLikeCommandDetail(previous) || isStartLikeCommandDetail(next)) {
    return true
  }

  const previousHasResult =
    Boolean(previous.output?.trim()) || typeof previous.exitCode === "number"
  const nextHasResult =
    Boolean(next.output?.trim()) || typeof next.exitCode === "number"
  return previousHasResult !== nextHasResult
}

function mergeCommandDetails(
  previous: ParsedLogDetail,
  next: ParsedLogDetail
): ParsedLogDetail {
  if (
    isStartLikeCommandDetail(next) &&
    commandDetailCompleteness(previous) >= commandDetailCompleteness(next)
  ) {
    return previous
  }

  const preferNext =
    commandDetailCompleteness(next) >= commandDetailCompleteness(previous)
  const primary = preferNext ? next : previous
  const fallback = preferNext ? previous : next
  return {
    ...fallback,
    ...primary,
    command: primary.command ?? fallback.command,
    exitCode: primary.exitCode ?? fallback.exitCode,
    kind: "command_execution",
    output: primary.output ?? fallback.output,
    status: primary.status ?? fallback.status,
  }
}

function coalesceToolDetails(details: ParsedLogDetail[]): ParsedLogDetail[] {
  const coalesced: ParsedLogDetail[] = []
  for (const detail of details) {
    const previous = coalesced.at(-1)
    if (shouldMergeCommandDetails(previous, detail)) {
      coalesced[coalesced.length - 1] = mergeCommandDetails(previous, detail)
    } else {
      coalesced.push(detail)
    }
  }
  return coalesced
}

const SetupLogRow = memo(function SetupLogRow({ log }: { log: ChatRunLog }) {
  const Icon =
    log.kind === "stderr" || log.kind === "command" ? Terminal : ScrollText
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2 text-[12px] leading-5",
        log.kind === "stderr" && "text-destructive",
        log.kind === "stdout" &&
          "font-mono text-[11px] text-muted-foreground/80",
        log.kind === "command" && "font-mono text-[11px] text-foreground/70"
      )}
    >
      <Icon className="mt-1 size-3 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{log.message}</div>
    </div>
  )
})

function unwrapShellCommand(cmd: string): string {
  let current = cmd
  // Repeatedly strip shell wrappers like `/bin/bash -lc "..."`,
  // `bash -c '...'`, `sh -c ...`, `env FOO=1 ...`.
  for (let i = 0; i < 4; i++) {
    const envMatch = current.match(/^env(?:\s+\w+=\S+)+\s+([\s\S]*)$/)
    if (envMatch) {
      current = envMatch[1].trim()
      continue
    }
    const shellMatch = current.match(
      /^(?:\/[\w/]*\/)?(?:bash|sh|zsh)(?:\s+-[a-z]+)*\s+(['"])([\s\S]*)\1\s*$/
    )
    if (shellMatch) {
      current = shellMatch[2].trim()
      continue
    }
    const shellNoQuote = current.match(
      /^(?:\/[\w/]*\/)?(?:bash|sh|zsh)\s+-[a-z]*c\s+([\s\S]*)$/
    )
    if (shellNoQuote) {
      current = shellNoQuote[1].trim().replace(/^['"]|['"]$/g, "")
      continue
    }
    break
  }
  return current || cmd
}

type ToolUmbrella = "explore" | "modify"

type FileOp = { op: "add" | "delete" | "update"; path: string }

const PATCH_FILE_REGEX = /\*\*\* (Add|Update|Delete) File:\s*([^\n]+)/g

function normalizeChangeOp(kind: string | undefined): FileOp["op"] | null {
  if (kind === "add" || kind === "create") return "add"
  if (kind === "delete" || kind === "remove") return "delete"
  if (kind === "update" || kind === "modify" || kind === "edit") {
    return "update"
  }
  return null
}

function extractFileOps(detail: ParsedLogDetail): FileOp[] {
  const changeOps = (detail.changes ?? []).flatMap((change) => {
    const op = normalizeChangeOp(change.kind)
    return op && change.path ? [{ op, path: change.path }] : []
  })
  if (changeOps.length > 0) return changeOps

  const sources: string[] = []
  if (detail.command) sources.push(detail.command)
  if (detail.text) sources.push(detail.text)
  const ops: FileOp[] = []
  for (const src of sources) {
    PATCH_FILE_REGEX.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PATCH_FILE_REGEX.exec(src)) !== null) {
      const op = m[1].toLowerCase() as FileOp["op"]
      ops.push({ op, path: m[2].trim() })
    }
  }
  return ops
}

function extractPatchBody(detail: ParsedLogDetail): string | null {
  const sources = [detail.command, detail.text].filter(
    (s): s is string => typeof s === "string" && s.length > 0
  )
  for (const src of sources) {
    const begin = src.indexOf("*** Begin Patch")
    const end = src.indexOf("*** End Patch")
    if (begin !== -1 && end !== -1 && end > begin) {
      return src.slice(begin, end + "*** End Patch".length).trim()
    }
    const start = src.search(/\*\*\* (Add|Update|Delete) File:/)
    if (start !== -1) return src.slice(start).trim()
  }
  return null
}

function buildDiffFromChanges(
  detail: ParsedLogDetail,
  fileOp?: FileOp
): string | null {
  const changes = detail.changes ?? []
  const parts: string[] = []
  for (const change of changes) {
    if (
      fileOp &&
      (!change.path || !pathsReferToSameFile(change.path, fileOp.path))
    ) {
      continue
    }
    if (!change.diff?.trim()) continue
    const normalized = normalizeChangeDiff(change)
    if (normalized) parts.push(normalized)
  }
  return parts.length > 0 ? parts.join("\n") : null
}

function normalizeChangeDiff(change: {
  diff?: string
  kind?: string
  path?: string
}): string | null {
  const diff = change.diff?.trim()
  if (!diff) return null
  // If the diff already carries `---`/`+++` file headers, trust it.
  if (/^---\s/m.test(diff) && /^\+\+\+\s/m.test(diff)) return diff
  // If the diff is an apply_patch fragment, convert it to unified diff.
  if (/^\*\*\* (Add|Update|Delete) File:/.test(diff)) {
    return applyPatchToUnifiedDiff(diff)
  }

  const path = change.path?.trim() ?? "file"
  const op = normalizeChangeOp(change.kind) ?? "update"
  const header: string[] = []
  if (op === "add") {
    header.push(`--- /dev/null`, `+++ b/${path}`)
  } else if (op === "delete") {
    header.push(`--- a/${path}`, `+++ /dev/null`)
  } else {
    header.push(`--- a/${path}`, `+++ b/${path}`)
  }
  // If the diff already has a hunk header, leave it; otherwise add a generic one.
  const body = /^@@\s/m.test(diff) ? diff : `@@ @@\n${diff}`
  return `${header.join("\n")}\n${body}`
}

function applyPatchToUnifiedDiff(patch: string): string {
  const inner = patch
    .replace(/^\*\*\* Begin Patch\s*\n?/, "")
    .replace(/\n?\*\*\* End Patch\s*$/, "")
    .trim()

  const fileBlockRegex =
    /\*\*\* (Add|Update|Delete) File:\s*([^\n]+)\n?([\s\S]*?)(?=\n\*\*\* (?:Add|Update|Delete) File:|$)/g

  const out: string[] = []
  let m: RegExpExecArray | null
  fileBlockRegex.lastIndex = 0
  while ((m = fileBlockRegex.exec(inner)) !== null) {
    const op = m[1]
    const path = m[2].trim()
    const body = m[3].replace(/\n+$/, "")
    if (op === "Add") {
      const addedLines = body
        .split("\n")
        .filter((line) => line.startsWith("+")).length
      out.push(`--- /dev/null`)
      out.push(`+++ b/${path}`)
      out.push(`@@ -0,0 +1,${addedLines || 1} @@`)
      if (body) out.push(body)
    } else if (op === "Delete") {
      out.push(`--- a/${path}`)
      out.push(`+++ /dev/null`)
      if (body) out.push(body)
    } else {
      out.push(`--- a/${path}`)
      out.push(`+++ b/${path}`)
      // Convert codex's bare `@@` hunk header into proper unified-diff form.
      const converted = body.replace(/^@@\s*$/gm, "@@ @@")
      if (converted) out.push(converted)
    }
  }
  return out.length > 0 ? out.join("\n") : patch
}

function extractPatchForFileOp(patch: string, fileOp: FileOp): string | null {
  const inner = patch
    .replace(/^\*\*\* Begin Patch\s*\n?/, "")
    .replace(/\n?\*\*\* End Patch\s*$/, "")
    .trim()
  const fileBlockRegex =
    /\*\*\* (Add|Update|Delete) File:\s*([^\n]+)\n?([\s\S]*?)(?=\n\*\*\* (?:Add|Update|Delete) File:|$)/g

  let m: RegExpExecArray | null
  fileBlockRegex.lastIndex = 0
  while ((m = fileBlockRegex.exec(inner)) !== null) {
    const path = m[2].trim()
    if (!pathsReferToSameFile(path, fileOp.path)) continue
    return `*** ${m[1]} File: ${path}\n${m[3].replace(/\n+$/, "")}`
  }
  return null
}

function normalizeDiffPath(path: string): string {
  return path
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^\/dev\/null$/, "")
    .replace(/^[ab]\//, "")
    .replace(/^\/root\/repo\//, "")
    .replace(/^\/workspace\//, "")
    .replace(/^\/+/, "")
}

function pathsReferToSameFile(left: string, right: string): boolean {
  const a = normalizeDiffPath(left)
  const b = normalizeDiffPath(right)
  if (!a || !b) return false
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

function filePathsFromUnifiedDiffBlock(block: string): string[] {
  const paths: string[] = []
  const gitHeader = block.match(/^diff --git\s+(\S+)\s+(\S+)/m)
  if (gitHeader) paths.push(gitHeader[1], gitHeader[2])

  for (const marker of [/^---\s+([^\t\n]+)/m, /^\+\+\+\s+([^\t\n]+)/m]) {
    const match = block.match(marker)
    if (match) paths.push(match[1])
  }

  return paths.filter((path) => normalizeDiffPath(path))
}

function extractRunDiffForFileOps(
  runDiff: string | undefined,
  fileOps: FileOp[]
): string | null {
  if (!runDiff?.trim() || fileOps.length === 0) return null

  const blocks = runDiff
    .split(/(?=^diff --git\s+)/m)
    .map((block) => block.trim())
    .filter(Boolean)
  const candidates = blocks.length > 0 ? blocks : [runDiff.trim()]
  const matched = candidates.filter((block) => {
    const blockPaths = filePathsFromUnifiedDiffBlock(block)
    return fileOps.some((op) =>
      blockPaths.some((path) => pathsReferToSameFile(path, op.path))
    )
  })

  return matched.length > 0 ? matched.join("\n\n") : null
}

function umbrellaForDetail(detail: ParsedLogDetail): ToolUmbrella {
  if (extractFileOps(detail).length > 0) return "modify"
  if (detail.kind === "file_change") return "modify"
  if (detail.kind === "command_execution") return "explore"
  const lower = (detail.name || "").toLowerCase()
  if (/edit|patch|write|create|update|apply|insert/.test(lower)) return "modify"
  return "explore"
}

type DetailKind = "read" | "search" | "command" | "edit" | "create" | "other"

type CommandIntent =
  | { kind: "command" }
  | { kind: "read"; target: string }
  | { kind: "search"; query: string }

const READ_PROGRAMS = new Set([
  "bat",
  "cat",
  "head",
  "less",
  "more",
  "sed",
  "tail",
  "view",
])

const SEARCH_PROGRAMS = new Set([
  "ack",
  "ag",
  "egrep",
  "fgrep",
  "find",
  "grep",
  "ripgrep",
  "rg",
])

function tokenizeShell(cmd: string): string[] {
  const matches = cmd.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g)
  return matches ?? []
}

function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0]
    const last = token[token.length - 1]
    if ((first === '"' || first === "'") && first === last) {
      return token.slice(1, -1)
    }
  }
  return token
}

function inferCommandIntent(rawCmd: string): CommandIntent {
  if (!rawCmd) return { kind: "command" }
  const firstSegment = rawCmd.split(/\||&&|;|\n/)[0].trim()
  const tokens = tokenizeShell(firstSegment)
  if (tokens.length === 0) return { kind: "command" }
  const program = stripQuotes(tokens[0]).split("/").pop() ?? ""
  const args = tokens.slice(1).map(stripQuotes)

  if (READ_PROGRAMS.has(program)) {
    const target = pickReadTarget(program, args)
    if (target) return { kind: "read", target }
  }
  if (SEARCH_PROGRAMS.has(program)) {
    const query = pickSearchQuery(program, args)
    if (query) return { kind: "search", query }
  }
  return { kind: "command" }
}

function pickReadTarget(program: string, args: string[]): string | null {
  const skipNext = new Set<number>()
  if (program === "head" || program === "tail") {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-n" || args[i] === "-c") skipNext.add(i + 1)
    }
  }
  if (program === "sed") {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-e" || args[i] === "-f") skipNext.add(i + 1)
    }
  }
  for (let i = args.length - 1; i >= 0; i--) {
    if (skipNext.has(i)) continue
    const arg = args[i]
    if (!arg || arg.startsWith("-")) continue
    return arg
  }
  return null
}

function pickSearchQuery(program: string, args: string[]): string | null {
  if (program === "find") {
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] === "-name" || args[i] === "-iname" || args[i] === "-path") {
        return args[i + 1]
      }
    }
    return null
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "-e" || arg === "--regexp") return args[i + 1] ?? null
    if (arg && !arg.startsWith("-")) return arg
  }
  return null
}

function classifyDetail(detail: ParsedLogDetail): DetailKind {
  const ops = extractFileOps(detail)
  if (ops.length > 0) {
    return ops.every((o) => o.op === "add") ? "create" : "edit"
  }
  if (detail.kind === "file_change") return "edit"
  if (detail.kind === "command_execution") {
    const intent = inferCommandIntent(
      unwrapShellCommand(detail.command?.trim() ?? "")
    )
    return intent.kind
  }
  const name = (detail.name || "").toLowerCase()
  if (/edit|patch|write|apply|insert|update/.test(name)) return "edit"
  if (/create/.test(name)) return "create"
  if (/list|search|grep|glob|find/.test(name)) return "search"
  if (/read|view|cat|open|file/.test(name)) return "read"
  return "other"
}

function bundleByUmbrella(
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

function summarizeBundle(
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

  // explore umbrella
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

function describeItem(detail: ParsedLogDetail): string {
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

function describeFileOp(op: FileOp): string {
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

const ToolGroup = memo(function ToolGroup({
  details,
  runDiff,
}: {
  details: ParsedLogDetail[]
  runDiff?: string
}) {
  const visibleDetails = useMemo(() => coalesceToolDetails(details), [details])
  if (visibleDetails.length === 0) return null
  const bundles = bundleByUmbrella(visibleDetails)
  return (
    <div className="space-y-1">
      {bundles.map((bundle, i) => (
        <ToolSummary
          key={`${bundle.umbrella}-${i}-${toolDetailKey(bundle.items[0])}`}
          umbrella={bundle.umbrella}
          items={bundle.items}
          runDiff={runDiff}
        />
      ))}
    </div>
  )
})

const ToolSummary = memo(function ToolSummary({
  umbrella,
  items,
  runDiff,
}: {
  umbrella: ToolUmbrella
  items: ParsedLogDetail[]
  runDiff?: string
}) {
  const [open, setOpen] = useState(false)
  const allSearches =
    umbrella === "explore" &&
    items.length > 0 &&
    items.every((item) => classifyDetail(item) === "search")
  const Icon =
    umbrella === "modify" ? Pencil : allSearches ? Search : SquareTerminal
  const label = summarizeBundle(umbrella, items)
  const failed = items.some(
    (d) => typeof d.exitCode === "number" && d.exitCode !== 0
  )
  const isSingleItem = items.length === 1
  const canExpand = items.length > 0
  const fileRowCount = items.reduce(
    (count, item) => count + extractFileOps(item).length,
    0
  )
  const showFileRows = umbrella === "modify" && fileRowCount > 1

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => canExpand && setOpen((v) => !v)}
        disabled={!canExpand}
        aria-expanded={canExpand ? open : undefined}
        className={cn(
          "group flex w-full min-w-0 items-center gap-2 py-0.5 text-left text-[13px] leading-6 text-muted-foreground/70 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
          canExpand && "cursor-pointer hover:text-foreground"
        )}
      >
        <Icon
          className={cn(
            "size-[15px] shrink-0",
            failed
              ? "text-destructive/80"
              : "text-muted-foreground/50 group-hover:text-muted-foreground/80"
          )}
          strokeWidth={1.5}
        />
        <span className="min-w-0 truncate">{label}</span>
        {open ? (
          <ChevronDown
            className="size-3.5 shrink-0 text-muted-foreground/50"
            strokeWidth={1.75}
          />
        ) : null}
      </button>
      {open && showFileRows ? (
        <div className="mt-0.5 ml-6 space-y-0.5">
          {items.flatMap((detail) => {
            const ops = extractFileOps(detail)
            if (ops.length === 0) {
              return [
                <ExpandableItemRow
                  key={toolDetailKey(detail)}
                  detail={detail}
                  runDiff={runDiff}
                />,
              ]
            }
            return ops.map((fileOp) => (
              <ExpandableFileRow
                key={`${toolDetailKey(detail)}:${fileOp.op}:${fileOp.path}`}
                detail={detail}
                fileOp={fileOp}
                runDiff={runDiff}
              />
            ))
          })}
        </div>
      ) : open && isSingleItem ? (
        <div className="mt-2 ml-6">
          <DetailView detail={items[0]} runDiff={runDiff} />
        </div>
      ) : open ? (
        <div className="mt-0.5 ml-6 space-y-0.5">
          {items.map((d) => (
            <ExpandableItemRow
              key={toolDetailKey(d)}
              detail={d}
              runDiff={runDiff}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
})

const ExpandableItemRow = memo(function ExpandableItemRow({
  detail,
  runDiff,
}: {
  detail: ParsedLogDetail
  runDiff?: string
}) {
  const [open, setOpen] = useState(false)
  const failed = typeof detail.exitCode === "number" && detail.exitCode !== 0
  const hasDetail = Boolean(
    detail.command?.trim() ||
    detail.text?.trim() ||
    detail.output?.trim() ||
    extractFileOps(detail).length > 0
  )
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        disabled={!hasDetail}
        aria-expanded={hasDetail ? open : undefined}
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left text-[14px] leading-7 text-muted-foreground/70 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
          hasDetail && "cursor-pointer hover:text-foreground",
          failed && "text-destructive/80"
        )}
      >
        <span className="min-w-0 truncate">{describeItem(detail)}</span>
        {open ? (
          <ChevronDown
            className="size-3 shrink-0 text-muted-foreground/50"
            strokeWidth={1.75}
          />
        ) : null}
      </button>
      {open && hasDetail ? (
        <div className="mt-2 mb-1">
          <DetailView detail={detail} runDiff={runDiff} />
        </div>
      ) : null}
    </div>
  )
})

const ExpandableFileRow = memo(function ExpandableFileRow({
  detail,
  fileOp,
  runDiff,
}: {
  detail: ParsedLogDetail
  fileOp: FileOp
  runDiff?: string
}) {
  const [open, setOpen] = useState(false)
  const failed = typeof detail.exitCode === "number" && detail.exitCode !== 0

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left text-[14px] leading-7 text-muted-foreground/70 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
          "cursor-pointer hover:text-foreground",
          failed && "text-destructive/80"
        )}
      >
        <span className="min-w-0 truncate">{describeFileOp(fileOp)}</span>
        {open ? (
          <ChevronDown
            className="size-3 shrink-0 text-muted-foreground/50"
            strokeWidth={1.75}
          />
        ) : null}
      </button>
      {open ? (
        <div className="mt-2 mb-1">
          <DetailView detail={detail} fileOp={fileOp} runDiff={runDiff} />
        </div>
      ) : null}
    </div>
  )
})

const DetailView = memo(function DetailView({
  detail,
  fileOp,
  runDiff,
}: {
  detail: ParsedLogDetail
  fileOp?: FileOp
  runDiff?: string
}) {
  const failed = typeof detail.exitCode === "number" && detail.exitCode !== 0
  const kind = classifyDetail(detail)
  const isCommand = detail.kind === "command_execution"
  const isFileChange = kind === "edit" || kind === "create"
  const patchBody = isFileChange ? extractPatchBody(detail) : null
  const rawPatchBody =
    patchBody && fileOp ? extractPatchForFileOp(patchBody, fileOp) : patchBody
  const fileOps = fileOp ? [fileOp] : extractFileOps(detail)
  const changesDiff = isFileChange ? buildDiffFromChanges(detail, fileOp) : null
  const runFileDiff =
    isFileChange && !rawPatchBody && !changesDiff
      ? extractRunDiffForFileOps(runDiff, fileOps)
      : null
  const diffBody = rawPatchBody
    ? applyPatchToUnifiedDiff(rawPatchBody)
    : (changesDiff ?? runFileDiff)
  const hasDiff = Boolean(diffBody)
  const cmd =
    isCommand && !hasDiff
      ? unwrapShellCommand(detail.command?.trim() ?? "")
      : ""
  const text = !isCommand && !hasDiff ? (detail.text?.trim() ?? "") : ""
  const output = detail.output?.trim() ?? ""
  const fileChanges = !hasDiff ? fileOps : []
  return (
    <div className="space-y-2">
      {diffBody ? (
        <div className="rounded-xl border border-border bg-background">
          <DiffList diff={diffBody} />
        </div>
      ) : null}
      {fileChanges.length > 0 ? (
        <div className="space-y-1 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
          {fileChanges.map((change) => (
            <div
              key={`${change.op}:${change.path}`}
              className="flex min-w-0 items-center gap-2 font-mono text-[11px] leading-5 text-muted-foreground"
            >
              <span className="shrink-0 uppercase">{change.op}</span>
              <span className="min-w-0 truncate">{change.path}</span>
            </div>
          ))}
        </div>
      ) : null}
      {cmd ? <CodeBlock body={cmd} lang="bash" /> : null}
      {text ? <CodeBlock body={text} lang="plaintext" /> : null}
      {output ? <CodeBlock body={output} lang="plaintext" /> : null}
      {failed ? (
        <div className="font-mono text-[11px] text-destructive/80">
          exit {detail.exitCode}
        </div>
      ) : null}
    </div>
  )
})
