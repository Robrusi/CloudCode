import type { CSSProperties } from "react"

import type { ChatImageAttachment } from "@/lib/chat/attachments"

export type ChatRunLog = {
  detail?: string
  id: string
  kind: "setup" | "command" | "reasoning" | "stdout" | "stderr" | "result"
  message: string
  time: number
}

export type ChatMessage = {
  attachments?: ChatImageAttachment[]
  content: string
  createdAt?: number
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

type ImageDimensions = {
  height: number
  width: number
} | null

const SETUP_SUMMARY_LOG_KINDS = new Set<ChatRunLog["kind"]>([
  "setup",
  "command",
  "reasoning",
  "stdout",
  "stderr",
  "result",
])

export function logsForMessage(
  messageId: string | undefined,
  logs: NonNullable<ChatMessage["meta"]>["logs"] | undefined
): ChatRunLog[] {
  return (
    logs?.map((log, index) => ({
      ...log,
      id: `${messageId ?? "message"}-${log.time}-${index}`,
    })) ?? []
  )
}

export function visibleSetupSummaryLogs(logs: ChatRunLog[]) {
  return logs.filter((log) => SETUP_SUMMARY_LOG_KINDS.has(log.kind))
}

/* How long a completed run worked, from the assistant message's creation to
   its last run log. Logs older than the message belong to a previous run on
   the thread (same rule as RunSetupSummary), so they are dropped rather than
   inflating the duration. Returns null when no usable log times exist. */
export function workedDurationMs(
  logs: ChatRunLog[],
  createdAt?: number
): number | null {
  let end = Number.NEGATIVE_INFINITY
  let start = Number.POSITIVE_INFINITY
  for (const log of logs) {
    if (!Number.isFinite(log.time)) continue
    if (createdAt && log.time < createdAt) continue
    if (log.time > end) end = log.time
    if (log.time < start) start = log.time
  }
  if (!Number.isFinite(end)) return null
  const duration = end - (createdAt ?? start)
  return duration > 0 ? duration : null
}

export function imageAttachmentLayout(
  dimensions: ImageDimensions,
  compact: boolean
): CSSProperties {
  const width = dimensions?.width ?? 4
  const height = dimensions?.height ?? 3
  const ratio = width / height
  const maxHeight = compact ? 180 : 420
  const maxWidth = compact ? 180 : 560
  const displayHeight = Math.min(height, maxHeight)
  const displayWidth = Math.min(
    width,
    maxWidth,
    Math.max(compact ? 120 : 180, Math.round(displayHeight * ratio))
  )

  return {
    aspectRatio: `${width} / ${height}`,
    maxHeight: compact ? "11.25rem" : "min(60vh, 26.25rem)",
    width: compact ? `${displayWidth}px` : `min(${displayWidth}px, 100%)`,
  }
}
