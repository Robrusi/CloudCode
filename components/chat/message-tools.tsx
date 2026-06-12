"use client"

import { ChevronDown, Pencil, Search, SquareTerminal } from "lucide-react"
import { memo, useMemo, useState } from "react"

import { DiffList } from "@/components/diff/changed-files"
import {
  classifyDetail,
  unwrapShellCommand,
} from "@/components/chat/tool-detail-classify"
import { coalesceToolDetails } from "@/components/chat/tool-detail-coalesce"
import {
  applyPatchToUnifiedDiff,
  buildDiffFromChanges,
  extractFileOps,
  extractPatchBody,
  extractPatchForFileOp,
  extractRunDiffForFileOps,
  type FileOp,
} from "@/components/chat/tool-detail-files"
import type { ParsedLogDetail } from "@/components/chat/tool-detail-types"
import {
  bundleByUmbrella,
  describeFileOp,
  describeItem,
  summarizeBundle,
  toolDetailKey,
  toolDetailRenderKey,
  type ToolUmbrella,
} from "@/components/chat/tool-details"
import { CodeBlock } from "@/components/code/block"
import { RecordingVideo } from "@/components/sandbox/recording-video"
import { cardSurfaceClass } from "@/components/ui/surface"
import { cn } from "@/lib/shared/utils"

export const ToolGroup = memo(function ToolGroup({
  details,
  runDiff,
  sandboxId,
}: {
  details: ParsedLogDetail[]
  runDiff?: string
  sandboxId?: string | null
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
          sandboxId={sandboxId}
        />
      ))}
    </div>
  )
})

const ToolSummary = memo(function ToolSummary({
  umbrella,
  items,
  runDiff,
  sandboxId,
}: {
  umbrella: ToolUmbrella
  items: ParsedLogDetail[]
  runDiff?: string
  sandboxId?: string | null
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
          {items.flatMap((detail, detailIndex) => {
            const ops = extractFileOps(detail)
            const detailKey = toolDetailRenderKey(
              detail,
              `${detailIndex}:${toolDetailKey(detail)}`
            )
            if (ops.length === 0) {
              return [
                <ExpandableItemRow
                  key={detailKey}
                  detail={detail}
                  runDiff={runDiff}
                  sandboxId={sandboxId}
                />,
              ]
            }
            return ops.map((fileOp, fileOpIndex) => (
              <ExpandableFileRow
                key={`${detailKey}:${fileOpIndex}:${fileOp.op}:${fileOp.path}`}
                detail={detail}
                fileOp={fileOp}
                runDiff={runDiff}
                sandboxId={sandboxId}
              />
            ))
          })}
        </div>
      ) : open && isSingleItem ? (
        <div className="mt-2 ml-6">
          <DetailView
            detail={items[0]}
            runDiff={runDiff}
            sandboxId={sandboxId}
          />
        </div>
      ) : open ? (
        <div className="mt-0.5 ml-6 space-y-0.5">
          {items.map((d, index) => (
            <ExpandableItemRow
              key={toolDetailRenderKey(d, `${index}:${toolDetailKey(d)}`)}
              detail={d}
              runDiff={runDiff}
              sandboxId={sandboxId}
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
  sandboxId,
}: {
  detail: ParsedLogDetail
  runDiff?: string
  sandboxId?: string | null
}) {
  const [open, setOpen] = useState(false)
  const failed = typeof detail.exitCode === "number" && detail.exitCode !== 0
  const hasDetail = Boolean(
    detail.command?.trim() ||
    detail.text?.trim() ||
    detail.output?.trim() ||
    detail.recording ||
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
          <DetailView detail={detail} runDiff={runDiff} sandboxId={sandboxId} />
        </div>
      ) : null}
    </div>
  )
})

const ExpandableFileRow = memo(function ExpandableFileRow({
  detail,
  fileOp,
  runDiff,
  sandboxId,
}: {
  detail: ParsedLogDetail
  fileOp: FileOp
  runDiff?: string
  sandboxId?: string | null
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
          <DetailView
            detail={detail}
            fileOp={fileOp}
            runDiff={runDiff}
            sandboxId={sandboxId}
          />
        </div>
      ) : null}
    </div>
  )
})

const DetailView = memo(function DetailView({
  detail,
  fileOp,
  runDiff,
  sandboxId,
}: {
  detail: ParsedLogDetail
  fileOp?: FileOp
  runDiff?: string
  sandboxId?: string | null
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
  const recording =
    detail.recording && (detail.recording.sandboxId || sandboxId)
      ? {
          ...detail.recording,
          sandboxId: detail.recording.sandboxId ?? sandboxId ?? undefined,
        }
      : null
  return (
    <div className="space-y-2">
      {recording ? <RecordingVideo recording={recording} /> : null}
      {diffBody ? (
        <div className={cn("overflow-hidden", cardSurfaceClass)}>
          <DiffList diff={diffBody} />
        </div>
      ) : null}
      {fileChanges.length > 0 ? (
        <div className="space-y-1 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
          {fileChanges.map((change, index) => (
            <div
              key={`${index}:${change.op}:${change.path}`}
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
