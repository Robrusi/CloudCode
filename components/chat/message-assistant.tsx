"use client"

import { ChevronRight } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { memo, useEffect, useRef, useState, type ReactNode } from "react"

import { formatWorkedDuration } from "@/components/chat/format"
import { MarkdownWithRecordingVideos } from "@/components/chat/message-media"
import {
  workedDurationMs,
  type ChatRunLog,
} from "@/components/chat/message-model"
import {
  type AssistantGroupedSegment,
  findLastTextSegmentIndex,
  groupAssistantContent,
  hasWorkBeforeFinalText,
  placeToolsBeforeFinalText,
  withFallbackTools,
} from "@/components/chat/message-segments"
import { ToolGroup } from "@/components/chat/message-tools"
import { toolDetailsFromLogs } from "@/components/chat/tool-details"
import type { ParsedLogDetail } from "@/components/chat/tool-detail-types"
import { cn } from "@/lib/shared/utils"

/* How long the finished run's work stays on screen before folding into the
   "Worked for" header. */
const WORK_FOLD_DELAY_MS = 600

export const AssistantBody = memo(function AssistantBody({
  text,
  repoName,
  onOpenFile,
  error,
  pending,
  logs,
  createdAt,
  runDiff,
  sandboxId,
}: {
  text: string
  repoName: string | null
  onOpenFile: (path: string) => void
  error: boolean
  pending: boolean
  logs: ChatRunLog[]
  createdAt?: number
  runDiff?: string
  sandboxId?: string | null
}) {
  const { grouped, hasToolMarkers } = groupAssistantContent(text)
  const fallbackTools = visibleFallbackTools(grouped, logs, hasToolMarkers)
  // While streaming, render parts in their natural arrival order. Reordering
  // tools above the last text (placeToolsBeforeFinalText) is a completed-message
  // presentation; applying it mid-stream hoists each in-progress tool above the
  // preamble text that precedes it, then drops it back down once the next text
  // arrives — a visible "jump".
  const ordered = pending
    ? withFallbackTools(grouped, fallbackTools)
    : placeToolsBeforeFinalText(grouped, fallbackTools)

  const lastTextIndex = pending ? -1 : findLastTextSegmentIndex(ordered)
  const showDisclosure =
    !pending && hasWorkBeforeFinalText(ordered, lastTextIndex)
  /* While streaming, everything is "work". On completion the final text moves
     out to the response area and the work stays in the same WorkSection
     container, so the fold animates the exact nodes that were streaming. */
  const workSegments = pending
    ? ordered
    : showDisclosure
      ? ordered.slice(0, lastTextIndex)
      : []
  const responseSegments = pending
    ? []
    : showDisclosure
      ? ordered.slice(lastTextIndex)
      : ordered

  return (
    <div className="space-y-3">
      {pending || showDisclosure ? (
        <WorkSection
          pending={pending}
          showHeader={showDisclosure}
          durationMs={showDisclosure ? workedDurationMs(logs, createdAt) : null}
        >
          <SegmentList
            segments={workSegments}
            error={error}
            repoName={repoName}
            onOpenFile={onOpenFile}
            runDiff={runDiff}
            sandboxId={sandboxId}
          />
        </WorkSection>
      ) : null}
      {responseSegments.length > 0 ? (
        <SegmentList
          segments={responseSegments}
          error={error}
          repoName={repoName}
          onOpenFile={onOpenFile}
          runDiff={runDiff}
          sandboxId={sandboxId}
        />
      ) : null}
    </div>
  )
})

/* The run's work (reasoning + tool activity). Stays mounted from streaming
   through completion: open while the run is pending, then — after a short
   beat — folds into the "Worked for 3m 11s ›" header, animating the same DOM
   the user was watching stream. Afterwards the header toggles it. */
const WorkSection = memo(function WorkSection({
  pending,
  showHeader,
  durationMs,
  children,
}: {
  pending: boolean
  showHeader: boolean
  durationMs: number | null
  children: ReactNode
}) {
  const [open, setOpen] = useState(pending)
  const wasPendingRef = useRef(pending)
  const foldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (wasPendingRef.current && !pending) {
      foldTimerRef.current = setTimeout(() => {
        foldTimerRef.current = null
        setOpen(false)
      }, WORK_FOLD_DELAY_MS)
    }
    wasPendingRef.current = pending
  }, [pending])
  useEffect(
    () => () => {
      if (foldTimerRef.current) clearTimeout(foldTimerRef.current)
    },
    []
  )

  const label =
    durationMs !== null
      ? `Worked for ${formatWorkedDuration(durationMs)}`
      : "Worked"

  return (
    <div className="min-w-0">
      {showHeader ? (
        <button
          type="button"
          onClick={() => {
            /* A user toggle wins over the pending auto-fold. */
            if (foldTimerRef.current) {
              clearTimeout(foldTimerRef.current)
              foldTimerRef.current = null
            }
            setOpen((v) => !v)
          }}
          aria-expanded={open}
          className="group flex cursor-pointer items-center gap-1.5 py-1 text-left text-[13px] leading-6 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <span>{label}</span>
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:text-muted-foreground/80",
              open && "rotate-90"
            )}
            strokeWidth={1.75}
          />
        </button>
      ) : null}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="work"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.32, ease: [0.4, 0, 0.2, 1] },
              opacity: { duration: 0.22, ease: "easeOut" },
            }}
            className="overflow-hidden"
          >
            <div className={cn("space-y-3", showHeader && "pt-2 pb-1")}>
              {children}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {showHeader ? (
        <div aria-hidden className="mt-2 h-px w-full bg-border" />
      ) : null}
    </div>
  )
})

const SegmentList = memo(function SegmentList({
  segments,
  error,
  repoName,
  onOpenFile,
  runDiff,
  sandboxId,
}: {
  segments: AssistantGroupedSegment[]
  error: boolean
  repoName: string | null
  onOpenFile: (path: string) => void
  runDiff?: string
  sandboxId?: string | null
}) {
  return (
    <>
      {segments.map((seg) =>
        seg.kind === "tools" ? (
          <ToolGroup
            key={seg.key}
            details={seg.details}
            runDiff={runDiff}
            sandboxId={sandboxId}
          />
        ) : seg.text.trim() ? (
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
        ) : null
      )}
    </>
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
