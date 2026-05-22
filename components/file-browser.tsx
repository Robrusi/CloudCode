"use client"

import { FileTree, useFileTree } from "@pierre/trees/react"
import type {
  FileTreeRowDecorationRenderer,
  GitStatusEntry,
} from "@pierre/trees"
import { Columns2, Loader2, Rows2, X } from "lucide-react"
import { useTheme } from "next-themes"
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  diffTypeToGitStatus,
  formatDiffStat,
  getDiffStats,
  type DiffFileStat,
} from "@/lib/diff-metadata"
import { cn } from "@/lib/utils"
import {
  readCachedFileList,
  writeCachedFileList,
} from "@/lib/sandbox-file-cache"

type FileEntry = { path: string; type: "file" | "dir" }
export type FileBrowserOpenMode = "diff" | "file" | "preview"
type BrowserView = "diffs" | "files"

type ListResponse = {
  root: string
  entries: FileEntry[]
  truncated?: boolean
  error?: string
}

const fileListCache = new Map<
  string,
  { entries: FileEntry[]; truncated: boolean }
>()

function applyLiveDiffToEntries(
  entries: readonly FileEntry[],
  changedFiles: readonly DiffFileStat[]
): FileEntry[] {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))

  for (const file of changedFiles) {
    if (file.prevPath && file.prevPath !== file.path) {
      byPath.delete(file.prevPath)
    }

    if (file.type === "deleted") {
      byPath.delete(file.path)
      continue
    }

    byPath.set(file.path, { path: file.path, type: "file" })
  }

  return Array.from(byPath.values()).sort((a, b) =>
    a.path.localeCompare(b.path)
  )
}

const TREE_SCROLLBAR_CSS = `
[data-file-tree-virtualized-scroll='true'],
[data-file-tree-scrollbar-measure='true'] {
  scrollbar-color: var(--trees-scrollbar-thumb) transparent;
  scrollbar-width: thin;
}

[data-file-tree-virtualized-scroll='true']::-webkit-scrollbar,
[data-file-tree-scrollbar-measure='true']::-webkit-scrollbar {
  width: var(--trees-scrollbar-gutter);
  height: var(--trees-scrollbar-gutter);
}

[data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-track,
[data-file-tree-scrollbar-measure='true']::-webkit-scrollbar-track {
  background: transparent;
}

[data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-thumb,
[data-file-tree-scrollbar-measure='true']::-webkit-scrollbar-thumb {
  background-color: var(--trees-scrollbar-thumb);
  background-clip: content-box;
  border: 0.5px solid transparent;
  border-radius: 999px;
}

[data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-thumb:vertical,
[data-file-tree-scrollbar-measure='true']::-webkit-scrollbar-thumb:vertical {
  border-block: 14px solid transparent;
  border-inline: 0.5px solid transparent;
}

[data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-thumb:horizontal,
[data-file-tree-scrollbar-measure='true']::-webkit-scrollbar-thumb:horizontal {
  border-block: 0.5px solid transparent;
  border-inline: 14px solid transparent;
}

[data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-corner,
[data-file-tree-scrollbar-measure='true']::-webkit-scrollbar-corner {
  background: transparent;
}
`

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
   * closed. Used to keep the tree's internal selection in sync — without this,
   * closing the editor would leave the path "selected" inside the tree and a
   * subsequent click on the same row would not fire `onSelectionChange`
   * (see `arePathSetsEqual` in `@pierre/trees`).
   */
  activePath: string | null
  activeMode: FileBrowserOpenMode
  onClose: () => void
  onOpenFile: (path: string, mode: FileBrowserOpenMode) => void
  onOpenAllDiffs?: () => void
}) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [view, setView] = useState<BrowserView>("files")

  const diffStats = useMemo(() => getDiffStats(diff), [diff])
  const liveEntries = useMemo(
    () => applyLiveDiffToEntries(entries, diffStats.files),
    [diffStats.files, entries]
  )

  const sandboxFilePaths = useMemo(() => {
    // @pierre/trees expects paths; directories should end with "/" so they
    // are explicitly recognised even when empty.
    return liveEntries.map((e) => (e.type === "dir" ? `${e.path}/` : e.path))
  }, [liveEntries])

  const diffFilePaths = useMemo(
    () => diffStats.files.map((file) => file.path),
    [diffStats.files]
  )

  const filePaths = view === "diffs" ? diffFilePaths : sandboxFilePaths

  const diffStatsByPath = useMemo(() => {
    const map = new Map<string, DiffFileStat>()
    for (const file of diffStats.files) {
      map.set(file.path, file)
      if (file.prevPath) map.set(file.prevPath, file)
    }
    return map
  }, [diffStats.files])

  const diffStatsByDirectory = useMemo(() => {
    const map = new Map<string, { additions: number; deletions: number }>()
    for (const file of diffStats.files) {
      const segments = file.path.split("/").filter(Boolean)
      for (let i = 1; i < segments.length; i++) {
        const dirPath = segments.slice(0, i).join("/")
        const current = map.get(dirPath) ?? { additions: 0, deletions: 0 }
        map.set(dirPath, {
          additions: current.additions + file.additions,
          deletions: current.deletions + file.deletions,
        })
      }
    }
    return map
  }, [diffStats.files])

  // In the diffs view we want every ancestor folder of a changed file open by
  // default so the user can see all changes at a glance. The files view keeps
  // the tree's default `initialExpansion: "closed"` behaviour.
  const expandedDirPaths = useMemo<readonly string[] | undefined>(() => {
    if (view !== "diffs") return undefined
    return Array.from(diffStatsByDirectory.keys())
  }, [view, diffStatsByDirectory])

  const gitStatus = useMemo<GitStatusEntry[]>(
    () =>
      diffStats.files.flatMap((file) => {
        const status = diffTypeToGitStatus(file.type)
        return file.prevPath && view === "files"
          ? [
              { path: file.path, status },
              { path: file.prevPath, status },
            ]
          : [{ path: file.path, status }]
      }),
    [diffStats.files, view]
  )

  const treePaths = filePaths.length > 0 ? filePaths : ["__empty__"]

  // Keep the selection handler referentially stable while letting it observe
  // the latest entry list and `onOpenFile` callback through refs.
  const fileEntryPathsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const set = new Set<string>()
    if (view === "diffs") {
      for (const file of diffStats.files) set.add(file.path)
    } else {
      for (const e of liveEntries) if (e.type === "file") set.add(e.path)
    }
    fileEntryPathsRef.current = set
  }, [diffStats.files, liveEntries, view])

  const onOpenFileRef = useRef(onOpenFile)
  const syncingSelectionRef = useRef(false)
  const viewRef = useRef(view)
  useEffect(() => {
    onOpenFileRef.current = onOpenFile
    viewRef.current = view
  }, [onOpenFile, view])

  const handleSelectionChange = useCallback((paths: readonly string[]) => {
    if (syncingSelectionRef.current) return
    const path = paths[0]
    if (!path || path === "__empty__") return
    if (!fileEntryPathsRef.current.has(path)) return
    onOpenFileRef.current(path, viewRef.current === "diffs" ? "diff" : "file")
  }, [])

  const diffStatsByPathRef = useRef(diffStatsByPath)
  const diffStatsByDirectoryRef = useRef(diffStatsByDirectory)
  useEffect(() => {
    diffStatsByPathRef.current = diffStatsByPath
    diffStatsByDirectoryRef.current = diffStatsByDirectory
  }, [diffStatsByDirectory, diffStatsByPath])

  const renderRowDecoration = useCallback<FileTreeRowDecorationRenderer>(
    ({ item }) => {
      const stat =
        item.kind === "directory"
          ? diffStatsByDirectoryRef.current.get(item.path)
          : diffStatsByPathRef.current.get(item.path)
      if (!stat) return null
      return {
        text: formatDiffStat(stat.additions, stat.deletions),
        title: `${stat.additions} additions, ${stat.deletions} deletions`,
      }
    },
    []
  )

  const { model } = useFileTree({
    paths: treePaths,
    flattenEmptyDirectories: false,
    gitStatus,
    initialExpansion: "closed",
    renderRowDecoration,
    search: true,
    unsafeCSS: TREE_SCROLLBAR_CSS,
    onSelectionChange: handleSelectionChange,
  })

  // Keep tree in sync with the entry list. When viewing diffs we hand the
  // tree the full set of ancestor directory paths so it rebuilds with every
  // folder pre-expanded; otherwise we let the tree fall back to its
  // `initialExpansion: "closed"` default.
  useEffect(() => {
    if (!model) return
    if (filePaths.length === 0) return
    model.resetPaths(
      filePaths,
      expandedDirPaths !== undefined
        ? { initialExpandedPaths: expandedDirPaths }
        : undefined
    )
  }, [model, filePaths, expandedDirPaths])

  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [gitStatus, model])

  // Mirror the externally-controlled `activePath` onto the tree's internal
  // selection. The tree only emits `onSelectionChange` when the selected-path
  // set actually changes, so if the editor closes (activePath -> null) without
  // us also clearing the tree's selection, clicking the same row again is a
  // no-op and the file never reopens.
  useEffect(() => {
    if (!model) return
    syncingSelectionRef.current = true
    const selected = model.getSelectedPaths()
    const viewMode: FileBrowserOpenMode = view === "diffs" ? "diff" : "file"
    if (activePath && activeMode === viewMode) {
      for (const p of selected) {
        if (p !== activePath) model.getItem(p)?.deselect()
      }
      if (!selected.includes(activePath)) {
        model.getItem(activePath)?.select()
      }
    } else {
      for (const p of selected) {
        model.getItem(p)?.deselect()
      }
    }
    queueMicrotask(() => {
      syncingSelectionRef.current = false
    })
  }, [activeMode, activePath, model, view])

  const fetchList = useCallback(async () => {
    if (!sandboxId) return
    const sourceKey = cacheScope ?? `sandbox:${sandboxId}`
    let cached = fileListCache.get(sourceKey)
    if (!cached && cacheScope) {
      const stored = await readCachedFileList(cacheScope)
      if (stored) {
        cached = {
          entries: stored.entries,
          truncated: stored.truncated,
        }
        fileListCache.set(sourceKey, cached)
      }
    }
    if (cached) {
      setEntries(cached.entries)
      setTruncated(cached.truncated)
    }
    setLoading(!cached)
    setError(null)
    try {
      const res = await fetch(
        `/api/sandbox/files/list?${new URLSearchParams({
          sandboxId,
        })}`,
        { cache: "no-store" }
      )
      const data: ListResponse = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`)
      }
      const nextEntries = data.entries ?? []
      const nextTruncated = Boolean(data.truncated)
      fileListCache.set(sourceKey, {
        entries: nextEntries,
        truncated: nextTruncated,
      })
      if (cacheScope) {
        void writeCachedFileList(cacheScope, {
          entries: nextEntries,
          sandboxId,
          truncated: nextTruncated,
        })
      }
      setEntries(nextEntries)
      setTruncated(nextTruncated)
    } catch (err) {
      if (!cached) {
        setError(err instanceof Error ? err.message : "Failed to load files")
        setEntries([])
      }
    } finally {
      setLoading(false)
    }
  }, [cacheScope, sandboxId])

  useEffect(() => {
    if (!open || !cacheScope) return
    let cancelled = false
    void readCachedFileList(cacheScope).then((cached) => {
      if (cancelled || !cached) return
      fileListCache.set(cacheScope, {
        entries: cached.entries,
        truncated: cached.truncated,
      })
      setEntries(cached.entries)
      setTruncated(cached.truncated)
      setError(null)
    })
    return () => {
      cancelled = true
    }
  }, [cacheScope, open])

  useEffect(() => {
    if (!open || !sandboxId) return
    const id = window.setTimeout(() => void fetchList(), 0)
    return () => window.clearTimeout(id)
  }, [open, sandboxId, fetchList])

  if (!open) return null

  return (
    <aside
      className="flex h-full min-h-0 w-[19rem] shrink-0 flex-col overflow-hidden border-l border-border/60 bg-sidebar text-sidebar-foreground"
      data-file-browser
    >
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span className="text-sm font-medium text-foreground/85">
          {view === "diffs" ? "Diffs" : "Files"}
        </span>
        {loading ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        {view === "diffs" && diffStyle && onDiffStyleChange ? (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <DiffStyleButton
              active={diffStyle === "unified"}
              label="Unified"
              icon={<Rows2 className="size-3.5" strokeWidth={2} />}
              onClick={() => onDiffStyleChange("unified")}
            />
            <DiffStyleButton
              active={diffStyle === "split"}
              label="Split"
              icon={<Columns2 className="size-3.5" strokeWidth={2} />}
              onClick={() => onDiffStyleChange("split")}
            />
          </div>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close file browser"
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
            view === "diffs" && diffStyle && onDiffStyleChange
              ? ""
              : "ml-auto"
          )}
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="flex h-[3.25rem] shrink-0 items-stretch border-b border-border/60">
        <ViewButton
          active={view === "files"}
          label="Files"
          onClick={() => setView("files")}
        />
        <div aria-hidden className="w-px self-stretch bg-border/60" />
        <ViewButton
          active={view === "diffs"}
          label="Diffs"
          onClick={() => {
            setView("diffs")
            onOpenAllDiffs?.()
          }}
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!sandboxId && filePaths.length === 0 ? (
          <EmptyState message="No cached files yet." />
        ) : error ? (
          <EmptyState
            message={error}
            actionLabel="Retry"
            onAction={fetchList}
          />
        ) : filePaths.length === 0 && !loading ? (
          <EmptyState
            message={view === "diffs" ? "No changed files." : "No files yet."}
            actionLabel={view === "diffs" ? undefined : "Refresh"}
            onAction={view === "diffs" ? undefined : fetchList}
          />
        ) : (
          <FileTreeWrapper model={model} />
        )}
        {truncated ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-border/60 bg-sidebar/95 px-3 py-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
            Listing truncated · refine search
          </div>
        ) : null}
      </div>
    </aside>
  )
}

// `@pierre/trees` resolves its defaults through `light-dark()` which keys off
// the host's `color-scheme` CSS property, so we declare it explicitly and
// then map every override to the same design tokens used by the rest of the
// app (sidebar, foreground, muted, accent, border).
function FileTreeWrapper({
  model,
}: {
  model: ReturnType<typeof useFileTree>["model"]
}) {
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === "dark"

  const style = useMemo<CSSProperties>(
    () =>
      ({
        height: "100%",
        width: "100%",
        paddingTop: "8px",
        colorScheme: dark ? "dark" : "light",
        "--trees-bg-override": "var(--sidebar)",
        "--trees-fg-override": "var(--sidebar-foreground)",
        "--trees-fg-muted-override": "var(--muted-foreground)",
        "--trees-bg-muted-override": "var(--sidebar-accent)",
        "--trees-selected-bg-override": "var(--sidebar-accent)",
        "--trees-selected-fg-override": "var(--sidebar-accent-foreground)",
        "--trees-selected-focused-border-color-override":
          "var(--sidebar-border)",
        "--trees-border-color-override": "var(--sidebar-border)",
        "--trees-indent-guide-bg-override": "var(--sidebar-border)",
        "--trees-scrollbar-thumb-override": "var(--scrollbar-thumb)",
        "--trees-scrollbar-gutter-override": "2px",
        "--trees-focus-ring-color-override": "var(--ring)",
        "--trees-font-family-override": "var(--font-sans)",
        "--trees-font-size-override": "12.5px",
        "--trees-item-padding-x-override": "8px",
        "--trees-padding-inline-override": "6px",
      }) as CSSProperties,
    [dark]
  )

  return <FileTree model={model} style={style} />
}

function ViewButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "flex-1 text-center text-xs font-medium text-foreground transition-colors"
          : "flex-1 text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      }
    >
      {label}
    </button>
  )
}

function DiffStyleButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean
  label: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
      )}
    >
      {icon}
    </button>
  )
}

function EmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="inline-flex h-7 items-center rounded-md border border-border/70 px-2.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-sidebar-accent"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
