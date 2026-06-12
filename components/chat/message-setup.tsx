"use client"

import { ChevronRight, Loader2, ScrollText, Terminal } from "lucide-react"
import { memo, useState } from "react"

import {
  visibleSetupSummaryLogs,
  type ChatRunLog,
} from "@/components/chat/message-model"
import { cn } from "@/lib/shared/utils"

export const RunSetupSummary = memo(function RunSetupSummary({
  contentStarted,
  logs,
  pending,
}: {
  contentStarted: boolean
  logs: ChatRunLog[]
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const setupLogs = visibleSetupSummaryLogs(logs)
  const current = setupLogs.at(-1)
  const hasReasoningLogs = setupLogs.some((log) => log.kind === "reasoning")
  const expanded = pending && !contentStarted ? true : open || hasReasoningLogs

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
