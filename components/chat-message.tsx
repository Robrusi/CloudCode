"use client"

import {
  ChevronRight,
  FileSearch,
  Loader2,
  ScrollText,
  SquarePen,
  Terminal,
  Wrench,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { memo, useState } from "react"

import { ChangedFiles } from "@/components/changed-files"
import { Markdown } from "@/components/chat-markdown"
import { cn } from "@/lib/utils"

export type ChatMessage = {
  content: string
  error?: boolean
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
  logs,
  message,
  onOpenFile,
  onOpenFileDiff,
  repoName,
}: {
  logs: ChatRunLog[]
  message: ChatMessage
  onOpenFile: (path: string) => void
  onOpenFileDiff: (path: string, diff: string) => void
  repoName: string | null
}) {
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
  | { kind: "text"; text: string }
  | { kind: "tool"; detail: ParsedLogDetail }

function splitContentByToolMarkers(text: string): AssistantSegment[] {
  const segments: AssistantSegment[] = []
  let last = 0
  let m: RegExpExecArray | null
  TOOL_MARKER_REGEX.lastIndex = 0
  while ((m = TOOL_MARKER_REGEX.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({ kind: "text", text: text.slice(last, m.index) })
    }
    try {
      const decoded = decodeURIComponent(m[1])
      const detail = JSON.parse(decoded) as ParsedLogDetail
      segments.push({ kind: "tool", detail })
    } catch {
      // ignore malformed marker
    }
    last = m.index + m[0].length
  }
  if (last < text.length) {
    segments.push({ kind: "text", text: text.slice(last) })
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
}: {
  text: string
  repoName: string | null
  onOpenFile: (path: string) => void
  error: boolean
  pending: boolean
  logs: ChatRunLog[]
}) {
  const segments = splitContentByToolMarkers(text)

  // Backwards compat: if persisted content has no markers but logs do contain
  // tool calls, render those after the text so they aren't lost.
  const hasMarkers = segments.some((s) => s.kind === "tool")
  const fallbackTools: ParsedLogDetail[] = []
  if (!hasMarkers) {
    for (const log of logs) {
      const detail = parseLogDetail(log.detail)
      if (
        log.kind === "command" &&
        (detail?.kind === "command_execution" || detail?.kind === "tool_call")
      ) {
        fallbackTools.push(detail)
      }
    }
  }

  const grouped: Array<
    | { kind: "text"; text: string }
    | { kind: "tools"; details: ParsedLogDetail[] }
  > = []
  if (fallbackTools.length > 0) {
    grouped.push({ kind: "tools", details: fallbackTools })
  }
  let toolBuf: ParsedLogDetail[] = []
  function flushToolBuf() {
    if (toolBuf.length === 0) return
    grouped.push({ kind: "tools", details: toolBuf })
    toolBuf = []
  }
  for (const seg of segments) {
    if (seg.kind === "tool") {
      toolBuf.push(seg.detail)
    } else {
      flushToolBuf()
      grouped.push(seg)
    }
  }
  flushToolBuf()

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
      (seg) =>
        seg.kind === "tools" || (seg.kind === "text" && seg.text.trim())
    )
  const showFinalSeparator = !pending && lastTextIndex > 0 && hasEarlierContent

  const rendered: React.ReactNode[] = []
  grouped.forEach((seg, i) => {
    if (showFinalSeparator && i === lastTextIndex) {
      rendered.push(
        <div
          key={`sep-${i}`}
          role="separator"
          aria-label="Response"
          className="flex items-center gap-4 py-4"
        >
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Response
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )
    }
    if (seg.kind === "tools") {
      rendered.push(<ToolGroup key={i} details={seg.details} />)
    } else if (seg.text.trim()) {
      rendered.push(
        <Markdown
          key={i}
          text={seg.text}
          className={cn(
            "text-[15px] leading-7",
            error && "text-destructive"
          )}
          repoName={repoName}
          onOpenFile={onOpenFile}
        />
      )
    }
  })

  return <div className="space-y-3">{rendered}</div>
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
  const codexStartIndex = getCodexStartIndex(logs)
  const codexStarted = codexStartIndex >= 0 || contentStarted
  const setupLogs =
    codexStartIndex >= 0
      ? logs.slice(0, codexStartIndex).filter(isSetupSummaryLog)
      : logs.filter(isSetupSummaryLog)
  const current = logs.at(-1)
  const expanded = pending && !codexStarted ? true : open

  if (!pending && setupLogs.length === 0) return null

  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        className="flex w-full min-w-0 items-center gap-2 text-left transition-colors hover:text-foreground"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            expanded && "rotate-90"
          )}
        />
        {pending && !codexStarted ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        ) : null}
        <span className="truncate text-[13px]">
          {codexStarted
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

function getCodexStartIndex(logs: ChatRunLog[]) {
  return logs.findIndex(isCodexStartLog)
}

function isCodexStartLog(log: ChatRunLog) {
  return log.kind === "setup" && /^Codex turn\b/.test(log.message)
}

function isSetupSummaryLog(log: ChatRunLog) {
  return log.kind === "setup" || log.kind === "stderr"
}

type ParsedLogDetail = {
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

const SetupLogRow = memo(function SetupLogRow({ log }: { log: ChatRunLog }) {
  const Icon = log.kind === "stderr" ? Terminal : ScrollText
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2 text-[12px] leading-5",
        log.kind === "stderr" && "text-destructive"
      )}
    >
      <Icon className="mt-1 size-3 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{log.message}</div>
    </div>
  )
})

type ToolPresentation = {
  body: string
  icon: LucideIcon
  label: string
}

function presentTool(detail: ParsedLogDetail): ToolPresentation {
  if (detail.kind === "command_execution") {
    return {
      body: detail.command?.trim() || "",
      icon: Terminal,
      label: "Shell",
    }
  }
  const name = (detail.name || "Tool").trim()
  const lower = name.toLowerCase()
  const text = detail.text?.trim()
  const body = text ? `${name}: ${text}` : name
  if (/edit|patch|write|create|update|apply|insert/.test(lower)) {
    return { body, icon: SquarePen, label: "File change" }
  }
  if (/read|view|cat|open|file/.test(lower)) {
    return { body, icon: ScrollText, label: "Read" }
  }
  if (/list|search|grep|glob|find/.test(lower)) {
    return { body, icon: FileSearch, label: "Search" }
  }
  return { body, icon: Wrench, label: "Tool" }
}

const ToolGroup = memo(function ToolGroup({
  details,
}: {
  details: ParsedLogDetail[]
}) {
  if (details.length === 0) return null
  return (
    <div className="rounded-lg border border-border/40 px-2.5 py-1">
      {details.map((detail, i) => (
        <ToolRow key={i} detail={detail} />
      ))}
    </div>
  )
})

const ToolRow = memo(function ToolRow({ detail }: { detail: ParsedLogDetail }) {
  const [open, setOpen] = useState(false)
  const failed =
    typeof detail.exitCode === "number" && detail.exitCode !== 0
  const { body, icon: Icon, label } = presentTool(detail)

  const fullCommand =
    detail.kind === "command_execution" ? detail.command?.trim() : undefined
  const fullText = detail.text?.trim()
  const output = detail.output?.trim()
  const hasDetails = Boolean(fullCommand || fullText || output)

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((v) => !v)}
        disabled={!hasDetails}
        aria-expanded={open}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 py-0.5 text-left text-[11.5px] leading-5 text-muted-foreground/70",
          hasDetails && "cursor-pointer hover:text-foreground"
        )}
      >
        <Icon
          className={cn(
            "size-3 shrink-0",
            failed ? "text-destructive/80" : "text-muted-foreground/50"
          )}
        />
        <span
          className={cn(
            "shrink-0",
            failed ? "text-destructive/80" : "text-muted-foreground/80"
          )}
        >
          {label}
        </span>
        {body ? (
          <>
            <span
              className="shrink-0 text-muted-foreground/40"
              aria-hidden
            >
              –
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 text-muted-foreground/60",
                !open && "truncate"
              )}
              title={!open ? body : undefined}
            >
              {body}
            </span>
          </>
        ) : null}
        {failed ? (
          <span className="shrink-0 font-mono text-[10.5px] text-destructive/80">
            exit {detail.exitCode}
          </span>
        ) : null}
        {hasDetails ? (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform text-muted-foreground/50",
              open && "rotate-90"
            )}
          />
        ) : null}
      </button>
      {open && hasDetails ? (
        <div className="ml-5 mt-1 mb-1 space-y-2 border-l border-border/60 pl-3">
          {fullCommand ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground/80">
              {fullCommand}
            </pre>
          ) : null}
          {fullText && !fullCommand ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground/80">
              {fullText}
            </pre>
          ) : null}
          {output ? (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                Output
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground/70">
                {output}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})
