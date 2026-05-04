"use client"

import {
  FileDiff,
  File as PierreFile,
  type FileContents,
  type FileOptions,
  type ThemeTypes,
} from "@pierre/diffs/react"
import {
  parseDiffFromFile,
  type FileDiffMetadata,
  type FileDiffOptions,
} from "@pierre/diffs"
import { ImageIcon, Loader2, X } from "lucide-react"
import { useTheme } from "next-themes"
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { cn } from "@/lib/utils"
import { findDiffForPath } from "@/lib/diff-metadata"

type ReadResponse = {
  path: string
  content: string
  size: number
  modifiedTime: string | null
  error?: string
  tooLarge?: boolean
}

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
])

const PIERRE_CODE_THEMES = {
  dark: "pierre-dark",
  light: "pierre-light",
} as const

const PIERRE_FILE_STYLE: CSSProperties = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "13px",
  "--diffs-line-height": "1.6",
  "--diffs-gap-block": "16px",
  "--diffs-gap-inline": "16px",
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

function basename(path: string): string {
  return path.split("/").pop() ?? path
}

function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase()
  return ext ? IMAGE_EXTENSIONS.has(ext) : false
}

/**
 * Reverse-apply the parsed patch to the *current* file contents to recover
 * the file as it looked before the changes. This lets us hand both old/new
 * full-file blobs to `parseDiffFromFile`, producing a non-partial
 * `FileDiffMetadata` that `<FileDiff>` can render with `expandUnchanged: true`
 * — i.e. the same diff styling as the Diffs view, but with every unchanged
 * line still visible around the hunks.
 *
 * NOTE on line splitting: `@pierre/diffs` splits with the lookbehind
 * `/(?<=\n)/`, which keeps the trailing newline attached to each entry of
 * `additionLines` / `deletionLines`. We mirror that so the lines we splice in
 * are byte-for-byte compatible (then join with `""`, not `"\n"`). Splitting
 * with `"\n"` and joining with `"\n"` here produces doubled newlines around
 * every replaced line and corrupts the reconstructed file.
 */
const SPLIT_KEEP_NEWLINES = /(?<=\n)/

function reconstructOldContent(
  newContent: string,
  fileDiff: FileDiffMetadata
): string {
  const oldLines = newContent.split(SPLIT_KEEP_NEWLINES)

  // Walk hunks back-to-front so earlier indices stay valid as we splice.
  for (let i = fileDiff.hunks.length - 1; i >= 0; i--) {
    const hunk = fileDiff.hunks[i]
    const oldHunkLines: string[] = []

    for (const block of hunk.hunkContent) {
      if (block.type === "context") {
        for (let j = 0; j < block.lines; j++) {
          oldHunkLines.push(fileDiff.deletionLines[block.deletionLineIndex + j])
        }
      } else {
        for (let j = 0; j < block.deletions; j++) {
          oldHunkLines.push(fileDiff.deletionLines[block.deletionLineIndex + j])
        }
      }
    }

    const start = Math.max(0, hunk.additionStart - 1)
    oldLines.splice(start, hunk.additionCount, ...oldHunkLines)
  }

  return oldLines.join("")
}

const MIN_PANEL_WIDTH = 280
const DEFAULT_PANEL_WIDTH = 640

export function FileEditorPanel({
  sandboxId,
  sandboxSnapshotId,
  activePath,
  diff,
  mode = "file",
  onClose,
  placement = "side",
}: {
  sandboxId: string | null
  sandboxSnapshotId: string | null
  activePath: string | null
  diff?: string
  mode?: "diff" | "file"
  onClose: () => void
  placement?: "main" | "side"
}) {
  // Panel width persists across mounts so the user's preferred size sticks
  // when they switch files.
  const [width, setWidth] = useState<number>(DEFAULT_PANEL_WIDTH)
  const dragStartRef = useRef<{ x: number; w: number } | null>(null)

  function handleResizeStart(e: ReactMouseEvent<HTMLDivElement>) {
    e.preventDefault()
    dragStartRef.current = { x: e.clientX, w: width }

    function onMove(ev: MouseEvent) {
      const ctx = dragStartRef.current
      if (!ctx) return
      const dx = ev.clientX - ctx.x
      // Dragging the LEFT edge: moving the cursor right shrinks the panel,
      // moving left enlarges it. Clamp against viewport so neighbouring
      // columns keep at least 360 px.
      const maxWidth = Math.max(
        MIN_PANEL_WIDTH,
        window.innerWidth - 360
      )
      const next = Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, ctx.w - dx))
      setWidth(next)
    }
    function onUp() {
      dragStartRef.current = null
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      document.body.style.removeProperty("cursor")
      document.body.style.removeProperty("user-select")
    }

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  const fileDiff = useMemo(
    () => (activePath ? findDiffForPath(diff, activePath) : undefined),
    [activePath, diff]
  )
  const diffStat = useMemo(() => {
    if (!fileDiff) return null
    return fileDiff.hunks.reduce(
      (acc, hunk) => ({
        additions: acc.additions + hunk.additionLines,
        deletions: acc.deletions + hunk.deletionLines,
      }),
      { additions: 0, deletions: 0 }
    )
  }, [fileDiff])

  if (!activePath) return null

  const sidePlacement = placement === "side"

  return (
    <section
      className={cn(
        "relative flex h-full min-h-0 flex-col overflow-hidden bg-background",
        sidePlacement
          ? "shrink-0 border-l border-border/60"
          : "min-w-0 flex-1"
      )}
      style={sidePlacement ? { width } : undefined}
    >
      {sidePlacement ? (
        // Drag handle on the left edge: an invisible lane that shows a subtle
        // divider accent on hover.
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file viewer"
          onMouseDown={handleResizeStart}
          className={cn(
            "absolute top-0 bottom-0 -left-1 z-10 w-2 cursor-col-resize",
            "before:absolute before:inset-y-0 before:left-1 before:w-px",
            "before:bg-transparent hover:before:bg-border"
          )}
        />
      ) : null}

      <header className="flex h-[3.25rem] shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl">
        <span
          className="min-w-0 flex-1 truncate font-sans text-[13px] text-muted-foreground"
          title={activePath}
        >
          {basename(activePath)}
        </span>
        {(sandboxId || sandboxSnapshotId) &&
        mode === "file" &&
        isImagePath(activePath) ? (
          <ImageDimensionsLabel
            key={`${sandboxId ?? sandboxSnapshotId}:${activePath}`}
            sandboxId={sandboxId}
            sandboxSnapshotId={sandboxSnapshotId}
            path={activePath}
          />
        ) : null}
        <span className="mr-[7px] shrink-0 text-[11px] tracking-wide text-muted-foreground uppercase">
          {mode === "diff" ? "Diff" : "File"}
        </span>
        {diffStat ? (
          <span
            className="shrink-0 font-mono text-[11px] tabular-nums"
            title={`${diffStat.additions} additions, ${diffStat.deletions} deletions`}
          >
            <span className="text-emerald-600 dark:text-emerald-400">
              +{diffStat.additions}
            </span>
            <span className="text-muted-foreground/60"> / </span>
            <span className="text-destructive">-{diffStat.deletions}</span>
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close file"
          className="-mr-[7px] inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1">
        <FileViewer
          // Remount per (sandbox, file) so each viewer starts crisp without
          // effect-driven state resets.
          key={`${mode}:${sandboxId ?? ""}:${sandboxSnapshotId ?? ""}:${activePath}`}
          fileDiff={fileDiff}
          mode={mode}
          sandboxId={sandboxId}
          sandboxSnapshotId={sandboxSnapshotId}
          path={activePath}
        />
      </div>
    </section>
  )
}

function FileViewer({
  fileDiff,
  mode,
  sandboxId,
  sandboxSnapshotId,
  path,
}: {
  fileDiff?: FileDiffMetadata
  mode: "diff" | "file"
  sandboxId: string | null
  sandboxSnapshotId: string | null
  path: string
}) {
  const imagePreview = useMemo(() => isImagePath(path), [path])
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(!imagePreview)
  const [error, setError] = useState<string | null>(null)

  const { resolvedTheme } = useTheme()
  const themeType: ThemeTypes = resolvedTheme === "dark" ? "dark" : "light"

  useEffect(() => {
    if (mode === "diff" || (!sandboxId && !sandboxSnapshotId) || imagePreview) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const params = new URLSearchParams({
          path,
          ...(sandboxId ? { sandboxId } : {}),
          ...(sandboxSnapshotId ? { snapshotId: sandboxSnapshotId } : {}),
        })
        const res = await fetch(
          `/api/sandbox/files/read?${params}`,
          { cache: "no-store" }
        )
        const data: ReadResponse = await res.json()
        if (cancelled) return
        if (!res.ok) {
          throw new Error(data.error ?? `Request failed (${res.status})`)
        }
        setContent(data.content)
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
  }, [imagePreview, mode, sandboxId, sandboxSnapshotId, path])

  const language = useMemo(() => getPierreLanguageFromPath(path), [path])

  const file = useMemo<FileContents | null>(() => {
    if (content === null) return null
    return {
      cacheKey: `${path}:${content}`,
      contents: content,
      lang: language,
      name: basename(path),
    }
  }, [content, language, path])

  const options = useMemo<FileOptions<undefined>>(
    () => ({
      disableFileHeader: true,
      disableLineNumbers: false,
      overflow: "wrap",
      theme: PIERRE_CODE_THEMES,
      themeType,
    }),
    [themeType]
  )

  const diffOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({
      diffIndicators: "bars",
      diffStyle: "unified",
      disableFileHeader: true,
      disableLineNumbers: false,
      hunkSeparators: "line-info-basic",
      lineDiffType: "word",
      overflow: "wrap",
      theme: PIERRE_CODE_THEMES,
      themeType,
    }),
    [themeType]
  )

  // In file mode, if the file actually changed, build a *non-partial*
  // FileDiffMetadata so `<FileDiff>` can render the hunks against the full
  // file (every unchanged line stays visible). Returns null when there's no
  // current content yet, no patch for this path, or reconstruction fails —
  // in any of those cases we fall back to the plain `<PierreFile>` viewer.
  const fileModeDiff = useMemo<FileDiffMetadata | null>(() => {
    if (mode !== "file") return null
    if (!fileDiff || content === null) return null
    try {
      const oldContent = reconstructOldContent(content, fileDiff)
      const oldFile: FileContents = {
        cacheKey: `${path}:old:${fileDiff.cacheKey ?? ""}`,
        contents: oldContent,
        lang: language,
        name: basename(path),
      }
      const newFile: FileContents = {
        cacheKey: `${path}:new:${content.length}`,
        contents: content,
        lang: language,
        name: basename(path),
      }
      return parseDiffFromFile(oldFile, newFile)
    } catch {
      return null
    }
  }, [content, fileDiff, language, mode, path])

  const fileModeDiffOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({
      ...diffOptions,
      // Show every line of the file, not just hunks + a few context lines.
      expandUnchanged: true,
    }),
    [diffOptions]
  )

  if (imagePreview) {
    if (!sandboxId && !sandboxSnapshotId) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
          <p className="text-xs text-destructive">No sandbox snapshot.</p>
        </div>
      )
    }

    return (
      <ImageViewer
        sandboxId={sandboxId}
        sandboxSnapshotId={sandboxSnapshotId}
        path={path}
      />
    )
  }

  if (mode === "diff") {
    if (!fileDiff) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
          <p className="text-xs text-muted-foreground">
            No saved diff for this file.
          </p>
        </div>
      )
    }

    return (
      <div className="h-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background">
        <FileDiff
          fileDiff={fileDiff}
          options={diffOptions}
          disableWorkerPool
          style={PIERRE_FILE_STYLE}
        />
      </div>
    )
  }

  if (!sandboxId && !sandboxSnapshotId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <p className="text-xs text-destructive">No sandbox snapshot.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <p className="text-xs text-destructive">{error}</p>
      </div>
    )
  }

  if (!file) return null

  // File has changes — render the full file as a diff (same component the
  // Diffs view uses) so removals/additions look identical. `expandUnchanged`
  // keeps every line visible, so the user sees the whole file plus the diff.
  if (fileModeDiff) {
    return (
      <div className="h-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background">
        <FileDiff
          fileDiff={fileModeDiff}
          options={fileModeDiffOptions}
          disableWorkerPool
          style={PIERRE_FILE_STYLE}
        />
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background">
      <PierreFile<undefined>
        file={file}
        options={options}
        disableWorkerPool
        style={PIERRE_FILE_STYLE}
      />
    </div>
  )
}

function ImageDimensionsLabel({
  sandboxId,
  sandboxSnapshotId,
  path,
}: {
  sandboxId: string | null
  sandboxSnapshotId: string | null
  path: string
}) {
  const [dimensions, setDimensions] = useState<{
    width: number
    height: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      setDimensions({
        width: image.naturalWidth,
        height: image.naturalHeight,
      })
    }
    image.onerror = () => {
      if (!cancelled) setDimensions(null)
    }
    const params = new URLSearchParams({
      path,
      format: "raw",
      ...(sandboxId ? { sandboxId } : {}),
      ...(sandboxSnapshotId ? { snapshotId: sandboxSnapshotId } : {}),
    })
    image.src = `/api/sandbox/files/read?${params}`

    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
    }
  }, [path, sandboxId, sandboxSnapshotId])

  if (!dimensions) return null

  return (
    <span className="shrink-0 font-sans text-[11px] tabular-nums text-muted-foreground">
      {dimensions.width} x {dimensions.height}
    </span>
  )
}

function ImageViewer({
  sandboxId,
  sandboxSnapshotId,
  path,
}: {
  sandboxId: string | null
  sandboxSnapshotId: string | null
  path: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  const src = useMemo(
    () => {
      const params = new URLSearchParams({
        path,
        format: "raw",
        ...(sandboxId ? { sandboxId } : {}),
        ...(sandboxSnapshotId ? { snapshotId: sandboxSnapshotId } : {}),
      })
      return `/api/sandbox/files/read?${params}`
    },
    [path, sandboxId, sandboxSnapshotId]
  )

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <ImageIcon className="size-5 text-muted-foreground" />
        <p className="text-xs text-destructive">Failed to load image.</p>
      </div>
    )
  }

  return (
    <div className="relative h-full min-h-0 overflow-auto bg-background">
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={basename(path)}
        onError={() => setError(true)}
        onLoad={() => setLoaded(true)}
        className={cn(
          "mx-auto block max-h-none max-w-none p-6",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  )
}
