"use client"

import { RefreshCw, X } from "lucide-react"
import { useMemo, useState } from "react"

import { FileViewer } from "@/components/files/editor-content"
import { ImageDimensionsLabel } from "@/components/files/editor-image"
import {
  basename,
  diffStat,
  isImagePath,
  isMarkdownPath,
  type FileViewMode,
} from "@/components/files/editor-model"
import { ResizeHandle } from "@/components/layout/resize-handle"
import { IconButton } from "@/components/ui/icon-button"
import {
  SegmentedControl,
  type SegmentedOption,
} from "@/components/ui/segmented-control"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { findDiffForPath } from "@/lib/diff/metadata"
import { diffCacheKey } from "@/lib/sandbox/file-cache"
import { cn } from "@/lib/shared/utils"

const MIN_PANEL_WIDTH = 280
const DEFAULT_PANEL_WIDTH = 640
const MAX_PANEL_WIDTH = 960

export function FileEditorPanel({
  sandboxId,
  cacheScope,
  activePath,
  diff,
  mode = "file",
  onClose,
  onOpenFile,
  onModeChange,
  placement = "side",
}: {
  sandboxId: string | null
  cacheScope: string | null
  activePath: string | null
  diff?: string
  mode?: FileViewMode
  onClose: () => void
  onOpenFile?: (path: string) => void
  onModeChange?: (mode: FileViewMode) => void
  placement?: "main" | "side"
}) {
  const isMobile = useIsMobile()
  const [refreshNonce, setRefreshNonce] = useState(0)
  const sidePlacement = placement === "side"
  const { width, resizing, onResizeStart, resetWidth } = useResizablePanel({
    storageKey: "cloudcode:fileEditorWidth",
    defaultWidth: DEFAULT_PANEL_WIDTH,
    minWidth: MIN_PANEL_WIDTH,
    maxWidth: MAX_PANEL_WIDTH,
    edge: "left",
    enabled: sidePlacement && !isMobile,
  })

  const fileDiff = useMemo(
    () => (activePath ? findDiffForPath(diff, activePath) : undefined),
    [activePath, diff]
  )
  const activeDiffKey = useMemo(() => diffCacheKey(diff), [diff])
  const diffStats = useMemo(
    () => (fileDiff ? diffStat(fileDiff) : null),
    [fileDiff]
  )

  if (!activePath) return null

  const markdownPreview = isMarkdownPath(activePath)

  return (
    <section
      className={cn(
        "relative flex h-full min-h-0 flex-col overflow-hidden bg-background",
        sidePlacement ? "shrink-0 border-l border-border/60" : "min-w-0 flex-1"
      )}
      style={sidePlacement ? { width } : undefined}
    >
      {sidePlacement ? (
        <ResizeHandle
          edge="left"
          resizing={resizing}
          onResizeStart={onResizeStart}
          onReset={resetWidth}
          ariaLabel="Resize file viewer"
        />
      ) : null}

      <header className="flex h-[3.25rem] shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl">
        <span
          className="min-w-0 flex-1 truncate font-sans text-[13px] text-muted-foreground"
          title={activePath}
        >
          {basename(activePath)}
        </span>
        {sandboxId && mode === "file" && isImagePath(activePath) ? (
          <ImageDimensionsLabel
            key={`${sandboxId}:${activePath}:${refreshNonce}`}
            sandboxId={sandboxId}
            path={activePath}
            refreshNonce={refreshNonce}
          />
        ) : null}
        <SegmentedControl<FileViewMode>
          value={mode}
          onChange={(next) => onModeChange?.(next)}
          label="File view mode"
          options={
            [
              { value: "file", label: "File" },
              { value: "diff", label: "Diff" },
              ...(markdownPreview
                ? [{ value: "preview", label: "Preview" }]
                : []),
            ] as SegmentedOption<FileViewMode>[]
          }
        />
        {diffStats ? (
          <span
            className="shrink-0 font-mono text-[11px] tabular-nums"
            title={`${diffStats.additions} additions, ${diffStats.deletions} deletions`}
          >
            <span className="text-success">+{diffStats.additions}</span>
            <span className="text-muted-foreground/60"> / </span>
            <span className="text-destructive">-{diffStats.deletions}</span>
          </span>
        ) : null}
        <IconButton
          onClick={() => setRefreshNonce((value) => value + 1)}
          aria-label="Refresh file"
          title="Refresh file"
          disabled={!sandboxId || mode === "diff"}
        >
          <RefreshCw className="size-3.5" />
        </IconButton>
        <IconButton
          onClick={onClose}
          aria-label="Close file"
          className="-mr-[7px]"
        >
          <X />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1">
        <FileViewer
          // Remount per file so loading/content state cannot bleed across paths.
          key={`${mode}:${sandboxId ?? ""}:${activePath}`}
          fileDiff={fileDiff}
          cacheScope={cacheScope}
          diffKey={activeDiffKey}
          mode={mode}
          onOpenFile={onOpenFile}
          refreshNonce={refreshNonce}
          sandboxId={sandboxId}
          path={activePath}
        />
      </div>
    </section>
  )
}
