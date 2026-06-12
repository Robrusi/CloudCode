"use client"

import { useFileTree } from "@pierre/trees/react"
import type {
  FileTreeRowDecorationRenderer,
  GitStatusEntry,
} from "@pierre/trees"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { TREE_SCROLLBAR_CSS } from "@/components/files/browser-ui"
import {
  applyLiveDiffToEntries,
  type BrowserView,
  type FileBrowserListResponse,
  type FileBrowserOpenMode,
} from "@/components/files/browser-model"
import {
  diffTypeToGitStatus,
  formatDiffStat,
  getDiffStats,
  type DiffFileStat,
} from "@/lib/diff/metadata"
import {
  readCachedFileList,
  writeCachedFileList,
  type SandboxFileEntry,
} from "@/lib/sandbox/file-cache"

const fileListCache = new Map<
  string,
  { entries: SandboxFileEntry[]; truncated: boolean }
>()

type UseFileBrowserControllerParams = {
  activeMode: FileBrowserOpenMode
  activePath: string | null
  cacheScope: string | null
  diff?: string
  onOpenFile: (path: string, mode: FileBrowserOpenMode) => void
  open: boolean
  sandboxId: string | null
}

export function useFileBrowserController({
  activeMode,
  activePath,
  cacheScope,
  diff,
  onOpenFile,
  open,
  sandboxId,
}: UseFileBrowserControllerParams) {
  const [entries, setEntries] = useState<SandboxFileEntry[]>([])
  const [entriesAuthoritative, setEntriesAuthoritative] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [view, setView] = useState<BrowserView>("files")

  const diffStats = useMemo(() => getDiffStats(diff), [diff])
  const liveEntries = useMemo(
    () =>
      applyLiveDiffToEntries(entries, diffStats.files, {
        includeMissingChangedFiles: !entriesAuthoritative,
      }),
    [diffStats.files, entries, entriesAuthoritative]
  )

  const sandboxFilePaths = useMemo(
    () => liveEntries.map((e) => (e.type === "dir" ? `${e.path}/` : e.path)),
    [liveEntries]
  )

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
  const fileEntryPathsRef = useRef<Set<string> | null>(null)

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
    if (!fileEntryPathsRef.current?.has(path)) return
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
    flattenEmptyDirectories: false,
    gitStatus,
    initialExpansion: "closed",
    onSelectionChange: handleSelectionChange,
    paths: treePaths,
    renderRowDecoration,
    search: true,
    unsafeCSS: TREE_SCROLLBAR_CSS,
  })

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

  const fetchList = useCallback(
    async ({
      force = false,
      signal,
    }: {
      force?: boolean
      signal?: AbortSignal
    } = {}) => {
      if (!sandboxId) return
      const sourceKey = cacheScope ?? `sandbox:${sandboxId}`
      let cached = force ? undefined : fileListCache.get(sourceKey)
      if (!force && !cached && cacheScope) {
        const stored = await readCachedFileList(cacheScope)
        if (signal?.aborted) return
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
        setEntriesAuthoritative(false)
        setTruncated(cached.truncated)
      }
      setLoading(force || !cached)
      setError(null)
      try {
        const res = await fetch(
          `/api/sandbox/files/list?${new URLSearchParams({
            sandboxId,
          })}`,
          { cache: "no-store", signal }
        )
        const data: FileBrowserListResponse = await res.json()
        if (signal?.aborted) return
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
        setEntriesAuthoritative(true)
        setTruncated(nextTruncated)
      } catch (err) {
        if (signal?.aborted) return
        if (!cached) {
          setError(err instanceof Error ? err.message : "Failed to load files")
          if (!force) setEntriesAuthoritative(false)
          setEntries((current) => (force && current.length > 0 ? current : []))
        }
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [cacheScope, sandboxId]
  )

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
      setEntriesAuthoritative(false)
      setTruncated(cached.truncated)
      setError(null)
    })
    return () => {
      cancelled = true
    }
  }, [cacheScope, open])

  useEffect(() => {
    if (!open || !sandboxId) return
    const controller = new AbortController()
    const id = window.setTimeout(
      () => void fetchList({ signal: controller.signal }),
      0
    )
    return () => {
      window.clearTimeout(id)
      controller.abort()
    }
  }, [open, sandboxId, fetchList])

  return {
    error,
    fetchList,
    filePaths,
    loading,
    model,
    setView,
    truncated,
    view,
  }
}
