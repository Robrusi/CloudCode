"use client"

import { memo, type ReactNode } from "react"

import { MarkdownWithRecordingVideos } from "@/components/chat/message-media"
import type { ChatRunLog } from "@/components/chat/message-model"
import {
  type AssistantGroupedSegment,
  findLastTextSegmentIndex,
  groupAssistantContent,
  placeToolsBeforeFinalText,
  shouldShowFinalResponseSeparator,
  withFallbackTools,
} from "@/components/chat/message-segments"
import { ToolGroup } from "@/components/chat/message-tools"
import { toolDetailsFromLogs } from "@/components/chat/tool-details"
import type { ParsedLogDetail } from "@/components/chat/tool-detail-types"
import { cn } from "@/lib/shared/utils"

export const AssistantBody = memo(function AssistantBody({
  text,
  repoName,
  onOpenFile,
  error,
  pending,
  logs,
  runDiff,
  sandboxId,
}: {
  text: string
  repoName: string | null
  onOpenFile: (path: string) => void
  error: boolean
  pending: boolean
  logs: ChatRunLog[]
  runDiff?: string
  sandboxId?: string | null
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
        sandboxId={sandboxId}
      />
    )
  }

  const { grouped, hasToolMarkers } = groupAssistantContent(text)
  const fallbackTools = visibleFallbackTools(grouped, logs, hasToolMarkers)
  const ordered = placeToolsBeforeFinalText(grouped, fallbackTools)

  const lastTextIndex = findLastTextSegmentIndex(ordered)
  const showFinalSeparator = shouldShowFinalResponseSeparator(
    ordered,
    lastTextIndex
  )

  const rendered: ReactNode[] = []
  ordered.forEach((seg, i) => {
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
        <ToolGroup
          key={seg.key}
          details={seg.details}
          runDiff={runDiff}
          sandboxId={sandboxId}
        />
      )
    } else if (seg.text.trim()) {
      rendered.push(
        <MarkdownWithRecordingVideos
          key={seg.key}
          text={seg.text}
          className={cn(
            "text-[14px] leading-6 md:text-[15px] md:leading-7",
            error && "text-destructive"
          )}
          repoName={repoName}
          onOpenFile={onOpenFile}
          sandboxId={sandboxId}
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
  sandboxId,
}: {
  text: string
  error: boolean
  repoName: string | null
  onOpenFile: (path: string) => void
  logs: ChatRunLog[]
  runDiff?: string
  sandboxId?: string | null
}) {
  const { grouped, hasToolMarkers } = groupAssistantContent(text)
  const fallbackTools = visibleFallbackTools(grouped, logs, hasToolMarkers)
  // While streaming, render parts in their natural arrival order. Reordering
  // tools above the last text (placeToolsBeforeFinalText) is a completed-message
  // presentation; applying it mid-stream hoists each in-progress tool above the
  // preamble text that precedes it, then drops it back down once the next text
  // arrives — the visible "jump" the user reported.
  const ordered = withFallbackTools(grouped, fallbackTools)

  return (
    <div className="space-y-3">
      {ordered.map((seg) =>
        seg.kind === "tools" ? (
          <ToolGroup
            key={seg.key}
            details={seg.details}
            runDiff={runDiff}
            sandboxId={sandboxId}
          />
        ) : (
          <MarkdownWithRecordingVideos
            key={seg.key}
            text={seg.text}
            className={cn(
              "text-[14px] leading-6 md:text-[15px] md:leading-7",
              error && "text-destructive"
            )}
            repoName={repoName}
            onOpenFile={onOpenFile}
            sandboxId={sandboxId}
          />
        )
      )}
    </div>
  )
})

function visibleFallbackTools(
  grouped: AssistantGroupedSegment[],
  logs: ChatRunLog[],
  hasToolMarkers: boolean
): ParsedLogDetail[] {
  const fallbackTools = toolDetailsFromLogs(logs)
  if (!hasToolMarkers || fallbackTools.length === 0) return fallbackTools

  const visibleIdentities = new Set(
    grouped
      .flatMap((segment) => (segment.kind === "tools" ? segment.details : []))
      .map(toolFallbackIdentity)
      .filter((identity): identity is string => Boolean(identity))
  )
  if (visibleIdentities.size === 0) return fallbackTools

  return fallbackTools.filter((detail) => {
    const identity = toolFallbackIdentity(detail)
    return !identity || !visibleIdentities.has(identity)
  })
}

function toolFallbackIdentity(detail: ParsedLogDetail): string | null {
  const itemId = detail.itemId?.trim()
  if (itemId) return `item:${itemId}`

  if (detail.kind === "command_execution") {
    const command = detail.command?.trim()
    return command ? `command:${command}` : null
  }

  if (detail.kind === "file_change") {
    const paths = detail.changes
      ?.map((change) => change.path?.trim())
      .filter(Boolean)
      .join(",")
    return paths ? `file:${paths}` : null
  }

  if (detail.kind === "tool_call") {
    const name = detail.name?.trim()
    const query = detail.query?.trim()
    const text = detail.text?.trim()
    if (name || query || text)
      return `tool:${name ?? ""}:${query ?? text ?? ""}`
  }

  return null
}
