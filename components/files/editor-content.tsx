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
import { Loader2 } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useMemo, useRef, useState } from "react"

import { Markdown } from "@/components/chat/markdown"
import {
  PIERRE_CODE_THEMES,
  PIERRE_FILE_STYLE,
  applyDiffToOldContent,
  basename,
  contentFromAdditionLines,
  getPierreLanguageFromPath,
  isImagePath,
  isMarkdownPath,
  reconstructOldContent,
  type FileViewMode,
} from "@/components/files/editor-model"
import { ImageViewer } from "@/components/files/editor-image"
import {
  fetchSandboxTextFileIntoCache,
  readCachedTextFile,
  writeCachedTextFile,
} from "@/lib/sandbox/file-cache"

type FileViewerProps = {
  fileDiff?: FileDiffMetadata
  cacheScope: string | null
  diffKey: string
  mode: FileViewMode
  onOpenFile?: (path: string) => void
  refreshNonce: number
  sandboxId: string | null
  path: string
}

function useTextFileContent({
  cacheScope,
  diffKey,
  fileDiff,
  imagePreview,
  mode,
  path,
  refreshNonce,
  sandboxId,
}: FileViewerProps & { imagePreview: boolean }) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(!imagePreview)
  const [error, setError] = useState<string | null>(null)
  const handledRefreshNonceRef = useRef(refreshNonce)

  useEffect(() => {
    if (mode === "diff" || imagePreview) {
      return
    }
    let cancelled = false
    void (async () => {
      const forceFresh = refreshNonce !== handledRefreshNonceRef.current
      if (forceFresh) {
        handledRefreshNonceRef.current = refreshNonce
      }
      if (forceFresh) {
        setLoading(true)
        setError(null)
      }

      const scope = cacheScope
      const cached =
        !forceFresh && scope ? await readCachedTextFile(scope, path) : null
      if (cancelled) return

      if (cached) {
        let displayedContent = cached.content
        if (fileDiff && cached.diffKey !== diffKey && scope) {
          const patchedContent = applyDiffToOldContent(cached.content, fileDiff)
          if (patchedContent !== null) {
            displayedContent = patchedContent
            void writeCachedTextFile(scope, path, {
              content: patchedContent,
              diffKey,
              modifiedTime: cached.modifiedTime,
              sandboxId: sandboxId ?? cached.sandboxId,
              size: new Blob([patchedContent]).size,
            })
          }
        }
        setContent(displayedContent)
        setLoading(false)
        setError(null)
      }

      if (!cached && fileDiff?.type === "new") {
        const newFileContent = contentFromAdditionLines(fileDiff)
        setContent(newFileContent)
        setLoading(false)
        setError(null)
        if (cacheScope) {
          void writeCachedTextFile(cacheScope, path, {
            content: newFileContent,
            diffKey,
            modifiedTime: null,
            sandboxId: sandboxId ?? undefined,
            size: new Blob([newFileContent]).size,
          })
        }
        return
      }

      const changedInCurrentDiff = Boolean(fileDiff)
      const cacheIsCurrent =
        cached &&
        !forceFresh &&
        (!changedInCurrentDiff || cached.diffKey === diffKey)
      if (cacheIsCurrent) return

      if (!sandboxId) {
        if (!cached) {
          setLoading(false)
          setError("No sandbox yet.")
        }
        return
      }

      try {
        const fresh = await fetchSandboxTextFileIntoCache({
          diffKey,
          force: forceFresh,
          path,
          sandboxId,
          scope: cacheScope ?? `sandbox:${sandboxId}`,
        })
        if (cancelled) return
        setContent(fresh.content)
      } catch (err) {
        if (cancelled) return
        if (!cached) {
          setError(err instanceof Error ? err.message : "Failed to read file")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    cacheScope,
    diffKey,
    fileDiff,
    imagePreview,
    mode,
    refreshNonce,
    sandboxId,
    path,
  ])

  return { content, error, loading }
}

export function FileViewer({
  fileDiff,
  cacheScope,
  diffKey,
  mode,
  onOpenFile,
  refreshNonce,
  sandboxId,
  path,
}: FileViewerProps) {
  const imagePreview = isImagePath(path)
  const markdownPreview = isMarkdownPath(path)
  const { content, error, loading } = useTextFileContent({
    cacheScope,
    diffKey,
    fileDiff,
    imagePreview,
    mode,
    path,
    refreshNonce,
    sandboxId,
  })
  const { resolvedTheme } = useTheme()
  const themeType: ThemeTypes = resolvedTheme === "dark" ? "dark" : "light"

  const language = getPierreLanguageFromPath(path)

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
  // current content yet, no patch for this path, or reconstruction fails - in
  // any of those cases we fall back to the plain `<PierreFile>` viewer.
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
    if (!sandboxId) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
          <p className="text-xs text-destructive">No sandbox yet.</p>
        </div>
      )
    }

    return (
      <ImageViewer
        key={`${sandboxId}:${path}:${refreshNonce}`}
        sandboxId={sandboxId}
        path={path}
        refreshNonce={refreshNonce}
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
      <div className="h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
        <FileDiff
          fileDiff={fileDiff}
          options={diffOptions}
          disableWorkerPool
          style={PIERRE_FILE_STYLE}
        />
      </div>
    )
  }

  if (!sandboxId && content === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <p className="text-xs text-destructive">{error ?? "No sandbox yet."}</p>
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

  if (mode === "preview" && markdownPreview) {
    return (
      <div className="h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
        <Markdown
          text={content ?? ""}
          repoName={null}
          onOpenFile={onOpenFile ?? (() => undefined)}
          className="mx-auto max-w-3xl px-4 py-5 text-sm leading-6 md:px-6"
        />
      </div>
    )
  }

  // File has changes - render the full file as a diff (same component the
  // Diffs view uses) so removals/additions look identical. `expandUnchanged`
  // keeps every line visible, so the user sees the whole file plus the diff.
  if (fileModeDiff) {
    return (
      <div className="h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
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
    <div className="h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
      <PierreFile<undefined>
        file={file}
        options={options}
        disableWorkerPool
        style={PIERRE_FILE_STYLE}
      />
    </div>
  )
}
