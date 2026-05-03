"use client"

import {
  FileDiff,
  File as PierreFile,
  type FileContents,
  type FileOptions,
  type ThemeTypes,
} from "@pierre/diffs/react"
import type {
  FileDiffMetadata,
  FileDiffOptions,
  LineAnnotation,
} from "@pierre/diffs"
import { Loader2, X } from "lucide-react"
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

type FileChangeAnnotation = {
  additions: number
  deletions: number
  addedLines: string[]
  removedLines: string[]
}

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

function buildFileChangeAnnotations(
  fileDiff?: FileDiffMetadata
): LineAnnotation<FileChangeAnnotation>[] {
  if (!fileDiff) return []
  const annotations: LineAnnotation<FileChangeAnnotation>[] = []

  for (const hunk of fileDiff.hunks) {
    let additionLine = hunk.additionStart
    for (const block of hunk.hunkContent) {
      if (block.type === "context") {
        additionLine += block.lines
        continue
      }

      // Slice the actual line text out of the parsed patch so we can render
      // the removed/added lines inline at the change site, instead of only
      // surfacing the +N / -N stat.
      const removedLines = fileDiff.deletionLines.slice(
        block.deletionLineIndex,
        block.deletionLineIndex + block.deletions
      )
      const addedLines = fileDiff.additionLines.slice(
        block.additionLineIndex,
        block.additionLineIndex + block.additions
      )

      annotations.push({
        lineNumber: Math.max(1, additionLine),
        metadata: {
          additions: block.additions,
          deletions: block.deletions,
          addedLines,
          removedLines,
        },
      })
      additionLine += block.additions
    }
  }

  return annotations
}

const MIN_PANEL_WIDTH = 280
const DEFAULT_PANEL_WIDTH = 640

export function FileEditorPanel({
  sandboxId,
  activePath,
  diff,
  mode = "file",
  onClose,
  placement = "side",
}: {
  sandboxId: string | null
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
        <span className="shrink-0 text-[11px] tracking-wide text-muted-foreground uppercase">
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
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1">
        <FileViewer
          // Remount per (sandbox, file) so each viewer starts crisp without
          // effect-driven state resets.
          key={`${mode}:${sandboxId ?? ""}:${activePath}`}
          fileDiff={fileDiff}
          mode={mode}
          sandboxId={sandboxId}
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
  path,
}: {
  fileDiff?: FileDiffMetadata
  mode: "diff" | "file"
  sandboxId: string | null
  path: string
}) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { resolvedTheme } = useTheme()
  const themeType: ThemeTypes = resolvedTheme === "dark" ? "dark" : "light"

  useEffect(() => {
    if (mode === "diff" || !sandboxId) return
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
  }, [mode, sandboxId, path])

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

  const options = useMemo<FileOptions<FileChangeAnnotation>>(
    () => ({
      disableFileHeader: true,
      disableLineNumbers: false,
      overflow: "wrap",
      theme: PIERRE_CODE_THEMES,
      themeType,
    }),
    [themeType]
  )

  const changeAnnotations = useMemo(
    () => (mode === "file" ? buildFileChangeAnnotations(fileDiff) : []),
    [fileDiff, mode]
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

  if (!sandboxId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <p className="text-xs text-destructive">No active sandbox.</p>
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

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background">
      <PierreFile<FileChangeAnnotation>
        file={file}
        lineAnnotations={changeAnnotations}
        options={options}
        renderAnnotation={(annotation) => (
          <ChangeAnnotation annotation={annotation} />
        )}
        disableWorkerPool
        style={PIERRE_FILE_STYLE}
      />
    </div>
  )
}

function ChangeAnnotation({
  annotation,
}: {
  annotation: LineAnnotation<FileChangeAnnotation>
}) {
  const { additions, deletions, addedLines, removedLines } = annotation.metadata

  return (
    <div className="border-l-2 border-emerald-500/70 bg-muted/40">
      <div className="flex items-center gap-2 px-3 py-1 font-sans text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Changed here</span>
        <span className="font-mono tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">
            +{additions}
          </span>
          <span className="text-muted-foreground/60"> / </span>
          <span className="text-destructive">-{deletions}</span>
        </span>
      </div>
      {removedLines.length > 0 || addedLines.length > 0 ? (
        <pre className="overflow-x-auto border-t border-border/40 px-0 py-1 font-mono text-[12px] leading-[1.55]">
          {removedLines.map((line, i) => (
            <DiffLine key={`d${i}`} kind="del" text={line} />
          ))}
          {addedLines.map((line, i) => (
            <DiffLine key={`a${i}`} kind="add" text={line} />
          ))}
        </pre>
      ) : null}
    </div>
  )
}

function DiffLine({ kind, text }: { kind: "add" | "del"; text: string }) {
  const isAdd = kind === "add"
  return (
    <div
      className={cn(
        "flex min-w-0 whitespace-pre",
        isAdd
          ? "bg-emerald-500/[0.10] text-emerald-700 dark:text-emerald-300"
          : "bg-destructive/[0.10] text-destructive"
      )}
    >
      <span
        aria-hidden
        className="inline-block w-6 shrink-0 select-none text-center opacity-70"
      >
        {isAdd ? "+" : "-"}
      </span>
      <span className="min-w-0 pr-3">{text === "" ? " " : text}</span>
    </div>
  )
}
