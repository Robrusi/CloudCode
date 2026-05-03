"use client"

import {
  File as PierreFile,
  type FileContents,
  type FileOptions,
  type ThemeTypes,
} from "@pierre/diffs/react"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { ArrowLeft, Loader2, Save, X } from "lucide-react"
import { useTheme } from "next-themes"
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { cn } from "@/lib/utils"

type FileEntry = { path: string; type: "file" | "dir" }

type ListResponse = {
  root: string
  entries: FileEntry[]
  truncated?: boolean
  error?: string
}

type ReadResponse = {
  path: string
  content: string
  size: number
  modifiedTime: string | null
  error?: string
  tooLarge?: boolean
}

const PIERRE_CODE_THEMES = {
  dark: "pierre-dark",
  light: "pierre-light",
} as const

const PIERRE_FILE_STYLE = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "13px",
  "--diffs-gap-block": "8px",
} as CSSProperties

const PIERRE_LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  mdx: "markdown",
  plaintext: "text",
  py: "python",
  sh: "bash",
  shell: "bash",
  text: "text",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
}

function getPierreLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "text"
  return PIERRE_LANGUAGE_ALIASES[ext] ?? ext
}

export function FileBrowser({
  sandboxId,
  open,
  onClose,
}: {
  sandboxId: string | null
  open: boolean
  onClose: () => void
}) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [activePath, setActivePath] = useState<string | null>(null)

  const filePaths = useMemo(() => {
    // @pierre/trees expects paths; directories should end with "/" so they
    // are explicitly recognised even when empty.
    return entries.map((e) => (e.type === "dir" ? `${e.path}/` : e.path))
  }, [entries])

  // Always provide non-empty paths so the model is happy. We re-mount the
  // FileTree by keying it on sandboxId so the underlying model rebuilds when
  // the sandbox changes.
  const treePaths = filePaths.length > 0 ? filePaths : ["__empty__"]

  // Keep the selection handler referentially stable while letting it observe
  // the latest entry list through a ref synced in a layout-style effect.
  const fileEntryPathsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.type === "file") set.add(e.path)
    fileEntryPathsRef.current = set
  }, [entries])

  const handleSelectionChange = useCallback((paths: readonly string[]) => {
    const path = paths[0]
    if (!path || path === "__empty__") return
    if (!fileEntryPathsRef.current.has(path)) return
    setActivePath(path)
  }, [])

  const { model } = useFileTree({
    paths: treePaths,
    flattenEmptyDirectories: false,
    initialExpansion: "closed",
    search: true,
    onSelectionChange: handleSelectionChange,
  })

  // Keep tree in sync with the entry list.
  useEffect(() => {
    if (!model) return
    if (filePaths.length === 0) return
    model.resetPaths(filePaths)
  }, [model, filePaths])

  const fetchList = useCallback(async () => {
    if (!sandboxId) return
    setLoading(true)
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
      setEntries(data.entries ?? [])
      setTruncated(Boolean(data.truncated))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files")
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [sandboxId])

  // Refetch whenever the panel becomes visible or the sandbox changes.
  useEffect(() => {
    if (!open || !sandboxId) return
    void fetchList()
  }, [open, sandboxId, fetchList])


  if (!open) return null

  return (
    <aside
      className="flex h-full w-[19rem] shrink-0 flex-col border-l border-border/60 bg-sidebar text-sidebar-foreground"
      data-file-browser
    >
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span className="text-sm font-medium text-foreground/85">
          All files
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

      <div className="relative flex-1 overflow-hidden">
        {!sandboxId ? (
          <EmptyState message="No active sandbox." />
        ) : error ? (
          <EmptyState
            message={error}
            actionLabel="Retry"
            onAction={fetchList}
          />
        ) : entries.length === 0 && !loading ? (
          <EmptyState
            message="No files yet."
            actionLabel="Refresh"
            onAction={fetchList}
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

      {activePath ? (
        // Key on the path so the viewer fully remounts when a different file
        // is selected — keeps initial state crisp without effect-driven resets.
        <FileViewer
          key={`${sandboxId ?? ""}:${activePath}`}
          sandboxId={sandboxId}
          path={activePath}
          onClose={() => setActivePath(null)}
        />
      ) : null}
    </aside>
  )
}

// Tiny wrapper so the @pierre/trees host element picks up our design tokens.
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
        // Surface tokens — pull straight from globals.css so the tree shares
        // the same palette as Sidebar/TopBar.
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
        "--trees-scrollbar-thumb-override": "var(--border)",
        "--trees-focus-ring-color-override": "var(--ring)",
        // Typography — match the app font ladder.
        "--trees-font-family-override": "var(--font-sans)",
        "--trees-font-size-override": "12.5px",
        "--trees-item-padding-x-override": "8px",
        "--trees-padding-inline-override": "6px",
      }) as CSSProperties,
    [dark]
  )

  return <FileTree model={model} style={style} />
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

function FileViewer({
  sandboxId,
  path,
  onClose,
}: {
  sandboxId: string | null
  path: string
  onClose: () => void
}) {
  // The component remounts (via key) whenever sandboxId/path changes, so we
  // can safely start in the "loading" state and never reset state in effects.
  const [content, setContent] = useState<string | null>(null)
  const [original, setOriginal] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { resolvedTheme } = useTheme()
  const themeType: ThemeTypes = resolvedTheme === "dark" ? "dark" : "light"

  useEffect(() => {
    if (!sandboxId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/sandbox/files/read?sandboxId=${encodeURIComponent(
            sandboxId
          )}&path=${encodeURIComponent(path)}`,
          { cache: "no-store" }
        )
        const data: ReadResponse = await res.json()
        if (cancelled) return
        if (!res.ok) {
          throw new Error(data.error ?? `Request failed (${res.status})`)
        }
        setContent(data.content)
        setOriginal(data.content)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Failed to read file")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sandboxId, path])

  const dirty = content !== null && original !== null && content !== original

  async function handleSave() {
    if (!sandboxId || content === null) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/sandbox/files/write", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sandboxId, path, content }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`)
      }
      setOriginal(content)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file")
    } finally {
      setSaving(false)
    }
  }

  const language = getPierreLanguageFromPath(path)

  const file = useMemo<FileContents | null>(() => {
    if (content === null) return null
    return {
      cacheKey: `${path}:${content}`,
      contents: content,
      lang: language,
      name: path.split("/").pop() ?? path,
    }
  }, [content, language, path])

  const options = useMemo<FileOptions<undefined>>(
    () => ({
      disableFileHeader: true,
      disableLineNumbers: false,
      overflow: "scroll",
      theme: PIERRE_CODE_THEMES,
      themeType,
    }),
    [themeType]
  )

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-sidebar">
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to file list"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
        <span
          className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/85"
          title={path}
        >
          {path}
        </span>
        {dirty ? (
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
            Modified
          </span>
        ) : null}
        {editing ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-[11px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-40"
            )}
          >
            {saving ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Save className="size-3" />
            )}
            <span>{saving ? "Saving" : "Save"}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditing(true)
              requestAnimationFrame(() => textareaRef.current?.focus())
            }}
            disabled={loading || error !== null || content === null}
            className="inline-flex h-7 items-center rounded-md border border-border/70 px-2.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-sidebar-accent disabled:opacity-40"
          >
            Edit
          </button>
        )}
      </header>

      <div className="relative flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        ) : content === null ? null : editing ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="block size-full resize-none bg-background/40 px-4 py-3 font-mono text-[12.5px] leading-5 text-foreground/90 outline-none"
          />
        ) : file ? (
          <div className="size-full overflow-auto">
            <PierreFile
              file={file}
              options={options}
              disableWorkerPool
              style={PIERRE_FILE_STYLE}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
