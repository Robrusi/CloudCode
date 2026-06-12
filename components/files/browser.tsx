"use client"

import { Columns2, RefreshCw, Rows2 } from "lucide-react"
import { useTheme } from "next-themes"

import { EnvironmentPanel } from "@/components/sandbox/environment-panel"
import type { FileBrowserOpenMode } from "@/components/files/browser-model"
import {
  FileBrowserEmptyState,
  FileTreeWrapper,
} from "@/components/files/browser-ui"
import { ResizableSidePanel } from "@/components/layout/resizable-side-panel"
import { SidePanelTabButton } from "@/components/layout/side-panel-tabs"
import { IconButton } from "@/components/ui/icon-button"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { useFileBrowserController } from "@/hooks/use-file-browser-controller"

export type { FileBrowserOpenMode } from "@/components/files/browser-model"

export function FileBrowser({
  sandboxId,
  cacheScope,
  open,
  diff,
  activePath,
  activeMode,
  onClose,
  onOpenFile,
  onOpenAllDiffs,
  diffStyle,
  onDiffStyleChange,
}: {
  sandboxId: string | null
  cacheScope: string | null
  open: boolean
  diff?: string
  diffStyle?: "unified" | "split"
  onDiffStyleChange?: (style: "unified" | "split") => void
  /**
   * The file path currently shown in the editor, or `null` when the editor is
   * closed. Used to keep the tree's internal selection in sync.
   */
  activePath: string | null
  activeMode: FileBrowserOpenMode
  onClose: () => void
  onOpenFile: (path: string, mode: FileBrowserOpenMode) => void
  onOpenAllDiffs?: () => void
}) {
  const { resolvedTheme } = useTheme()
  const {
    error,
    fetchList,
    filePaths,
    loading,
    model,
    setView,
    truncated,
    view,
  } = useFileBrowserController({
    activeMode,
    activePath,
    cacheScope,
    diff,
    onOpenFile,
    open,
    sandboxId,
  })

  if (!open) return null

  return (
    <ResizableSidePanel
      open={open}
      title={
        view === "diffs" ? "Diffs" : view === "env" ? "Environment" : "Files"
      }
      busy={loading}
      onClose={onClose}
      closeLabel="Close file browser"
      resizeLabel="Resize file browser"
      storageKey="cloudcode:fileBrowserWidth"
      defaultWidth={304}
      minWidth={240}
      maxWidth={560}
      dataAttributes={{ "data-file-browser": true }}
      headerActions={
        <>
          {view === "diffs" && diffStyle && onDiffStyleChange ? (
            <SegmentedControl<"unified" | "split">
              value={diffStyle}
              onChange={onDiffStyleChange}
              label="Diff style"
              className="hidden md:inline-flex"
              options={[
                {
                  value: "unified",
                  ariaLabel: "Unified",
                  title: "Unified",
                  icon: <Rows2 className="size-3.5" strokeWidth={2} />,
                },
                {
                  value: "split",
                  ariaLabel: "Split",
                  title: "Split",
                  icon: <Columns2 className="size-3.5" strokeWidth={2} />,
                },
              ]}
            />
          ) : null}
          {view === "files" ? (
            <IconButton
              onClick={() => void fetchList({ force: true })}
              aria-label="Refresh files"
              title="Refresh files"
              disabled={!sandboxId || loading}
            >
              <RefreshCw className="size-3.5" />
            </IconButton>
          ) : null}
        </>
      }
    >
      <div className="flex h-[3.25rem] shrink-0 items-stretch border-b border-border/60">
        <SidePanelTabButton
          active={view === "files"}
          label="Files"
          onClick={() => setView("files")}
        />
        <div aria-hidden className="w-px self-stretch bg-border/60" />
        <SidePanelTabButton
          active={view === "diffs"}
          label="Diffs"
          onClick={() => {
            setView("diffs")
            onOpenAllDiffs?.()
          }}
        />
        <div aria-hidden className="w-px self-stretch bg-border/60" />
        <SidePanelTabButton
          active={view === "env"}
          label="Environment"
          onClick={() => setView("env")}
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {view === "env" ? (
          <EnvironmentPanel
            key={sandboxId ?? "no-sandbox"}
            sandboxId={sandboxId}
          />
        ) : !sandboxId && filePaths.length === 0 ? (
          <FileBrowserEmptyState message="No cached files yet." />
        ) : error ? (
          <FileBrowserEmptyState
            message={error}
            actionLabel="Retry"
            onAction={() => void fetchList({ force: true })}
          />
        ) : filePaths.length === 0 && !loading ? (
          <FileBrowserEmptyState
            message={view === "diffs" ? "No changed files." : "No files yet."}
            actionLabel={view === "diffs" ? undefined : "Refresh"}
            onAction={
              view === "diffs"
                ? undefined
                : () => void fetchList({ force: true })
            }
          />
        ) : (
          <FileTreeWrapper dark={resolvedTheme === "dark"} model={model} />
        )}
        {truncated ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-border/60 bg-sidebar/95 px-3 py-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
            Listing truncated · refine search
          </div>
        ) : null}
      </div>
    </ResizableSidePanel>
  )
}
