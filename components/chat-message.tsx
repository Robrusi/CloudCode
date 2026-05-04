"use client"

import {
  Brain,
  ChevronRight,
  Loader2,
  ScrollText,
  Terminal,
} from "lucide-react"
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
  repoName,
}: {
  logs: ChatRunLog[]
  message: ChatMessage
  onOpenFile: (path: string) => void
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

  return (
    <div className="space-y-3">
      {message.pending || logs.length > 0 ? (
        <RunLogs logs={logs} pending={Boolean(message.pending)} />
      ) : null}
      {!message.pending ? (
        <Markdown
          text={message.content}
          className={cn(
            "text-[15px] leading-7",
            message.error && "text-destructive"
          )}
          repoName={repoName}
          onOpenFile={onOpenFile}
        />
      ) : null}
      {!message.pending && message.meta?.diff ? (
        <ChangedFiles diff={message.meta.diff} />
      ) : null}
      {message.meta?.branch ? (
        <div className="font-mono text-[11px] text-muted-foreground">
          ↳ {message.meta.branch}
        </div>
      ) : null}
    </div>
  )
})

const RunLogs = memo(function RunLogs({
  logs,
  pending,
}: {
  logs: ChatRunLog[]
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const visible = logs
  const current = logs.at(-1)
  const expanded = pending || open

  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <button
        type="button"
        onClick={() => {
          if (!pending) setOpen((currentOpen) => !currentOpen)
        }}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 text-left",
          !pending && "cursor-pointer hover:text-foreground"
        )}
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            expanded && "rotate-90"
          )}
        />
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        <span className="truncate">
          {pending
            ? (current?.message ?? "Starting Codex run")
            : (current?.message ?? "Codex run completed")}
        </span>
      </button>

      {expanded && visible.length > 0 ? (
        <div className="space-y-1 border-l border-border/70 pl-3">
          {visible.map((log) => (
            <RunLogRow key={log.id} log={log} />
          ))}
        </div>
      ) : null}
    </div>
  )
})

const RunLogRow = memo(function RunLogRow({ log }: { log: ChatRunLog }) {
  const Icon =
    log.kind === "reasoning"
      ? Brain
      : log.kind === "command"
        ? Terminal
        : ScrollText

  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2 font-mono text-[11px] leading-5",
        log.kind === "stderr" && "text-destructive"
      )}
    >
      <Icon className="mt-1 size-3 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="break-words">{log.message}</div>
        {log.detail ? (
          <div className="truncate text-muted-foreground/70">{log.detail}</div>
        ) : null}
      </div>
    </div>
  )
})
