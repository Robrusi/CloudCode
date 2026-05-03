"use client"

import { FileTree, useFileTree } from "@pierre/trees/react"
import type {
  FileTreeRowDecorationRenderer,
  GitStatusEntry,
} from "@pierre/trees"
import { Loader2, X } from "lucide-react"
import { useTheme } from "next-themes"
import {
  type CSSProperties,
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

type FileEntry = { path: string; type: "file" | "dir" }
export type FileBrowserOpenMode = "diff" | "file"
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
  open,
  diff,
  activePath,
  onClose,
  onOpenFile,
}: {
  sandboxId: string | null
  open: boolean
  diff?: string
  /**
   * The file path currently shown in the editor, or `null` when the editor is
   * closed. Used to keep the tree's internal selection in sync — without this,
   * closing the editor would leave the path "selected" inside the tree and a
   * subsequent click on the same row would not fire `onSelectionChange`
   * (see `arePathSetsEqual` in `@pierre/trees`).
   */
  activePath: string | null
  onClose: () => void
  onOpenFile: (path: string, mode: FileBrowserOpenMode) => void
}) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [view, setView] = useState<BrowserView>("files")

  const diffStats = useMemo(() => getDiffStats(diff), [diff])

  const sandboxFilePaths = useMemo(() => {
    // @pierre/trees expects paths; directories should end with "/" so they
    // are explicitly recognised even when empty.
    return entries.map((e) => (e.type === "dir" ? `${e.path}/` : e.path))
  }, [entries])

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
      for (const e of entries) if (e.type === "file") set.add(e.path)
    }
    fileEntryPathsRef.current = set
  }, [diffStats.files, entries, view])

  const onOpenFileRef = useRef(onOpenFile)
  const viewRef = useRef(view)
  useEffect(() => {
    onOpenFileRef.current = onOpenFile
    viewRef.current = view
  }, [onOpenFile, view])

  const handleSelectionChange = useCallback((paths: readonly string[]) => {
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

  // Keep tree in sync with the entry list.
  useEffect(() => {
    if (!model) return
    if (filePaths.length === 0) return
    model.resetPaths(filePaths)
  }, [model, filePaths])

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
    const selected = model.getSelectedPaths()
    if (activePath) {
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
  }, [activePath, model])

  const fetchList = useCallback(async () => {
    if (!sandboxId) return
    const cached = fileListCache.get(sandboxId)
    if (cached) {
      setEntries(cached.entries)
      setTruncated(cached.truncated)
    }
    setLoading(!cached)
    setError(null)
    try {
      const res = await fetch(
        `/api/sandbox/files/list?sandboxId=${encodeURIComponent(sandboxId)}`,
        { cache: "no-store" }
      )
      const data: ListResponse = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`)
      }
      const nextEntries = data.entries ?? []
      const nextTruncated = Boolean(data.truncated)
      fileListCache.set(sandboxId, {
        entries: nextEntries,
        truncated: nextTruncated,
      })
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
  }, [sandboxId])

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
        <button
          type="button"
          onClick={onClose}
          aria-label="Close file browser"
          className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="flex h-[3.25rem] shrink-0 items-center border-b border-border/60 px-2">
        <div className="grid h-8 w-full grid-cols-2 gap-1 rounded-md bg-sidebar-accent/60 p-1">
          <ViewButton
            active={view === "files"}
            label="Files"
            onClick={() => setView("files")}
          />
          <ViewButton
            active={view === "diffs"}
            label="Diffs"
            onClick={() => setView("diffs")}
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!sandboxId ? (
          <EmptyState message="No active sandbox." />
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
      className={
        active
          ? "rounded-sm bg-background px-2 text-xs font-medium text-foreground shadow-sm"
          : "rounded-sm px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      }
    >
      {label}
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
