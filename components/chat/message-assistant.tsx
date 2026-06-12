"use client"

import { memo, type ReactNode } from "react"

import { MarkdownWithRecordingVideos } from "@/components/chat/message-media"
import type { ChatRunLog } from "@/components/chat/message-model"
import {
  EMPTY_TOOL_DETAILS,
  findLastTextSegmentIndex,
  groupAssistantContent,
  shouldShowFinalResponseSeparator,
} from "@/components/chat/message-segments"
import { ToolGroup } from "@/components/chat/message-tools"
import { toolDetailsFromLogs } from "@/components/chat/tool-details"
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
  const fallbackTools = hasToolMarkers ? [] : toolDetailsFromLogs(logs)
  if (fallbackTools.length > 0) {
    grouped.push({
      details: fallbackTools,
      key: "fallback-tools",
      kind: "tools",
    })
  }

  const lastTextIndex = findLastTextSegmentIndex(grouped)
  const showFinalSeparator = shouldShowFinalResponseSeparator(
    grouped,
    lastTextIndex
  )

  const rendered: ReactNode[] = []
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
  const fallbackTools = hasToolMarkers
    ? EMPTY_TOOL_DETAILS
    : toolDetailsFromLogs(logs)

  return (
    <div className="space-y-3">
      {grouped.map((seg) =>
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
      {fallbackTools.length > 0 ? (
        <ToolGroup
          details={fallbackTools}
          runDiff={runDiff}
          sandboxId={sandboxId}
        />
      ) : null}
    </div>
  )
})
