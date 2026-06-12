"use client"

import { useEffect, useMemo } from "react"

import {
  canPrefetchAsText,
  MAX_PREFETCHED_CHANGED_TEXT_FILES,
  TEXT_FILE_PREFETCH_CONCURRENCY,
  TEXT_FILE_PREFETCH_DELAY_MS,
} from "@/components/chat/prefetch"
import type { ChatRecord } from "@/components/chat/types"
import { getDiffStats } from "@/lib/diff/metadata"
import {
  diffCacheKey,
  fetchSandboxTextFileIntoCache,
} from "@/lib/sandbox/file-cache"

function latestMessageMeta(active: ChatRecord | null): {
  branch: string | null
  diff: string | null
} {
  if (!active) return { branch: null, diff: null }

  let branch: string | null = null
  let diff: string | null = null
  for (let index = active.messages.length - 1; index >= 0; index -= 1) {
    const meta = active.messages[index].meta
    if (!diff && meta?.diff) diff = meta.diff
    if (!branch && meta?.branch) branch = meta.branch
    if (branch && diff) break
  }

  return { branch, diff }
}

export function useChatDiffState({
  active,
  activeFileCacheScope,
  activeFileDiff,
  activeSandboxId,
}: {
  active: ChatRecord | null
  activeFileCacheScope: string | null
  activeFileDiff: string | null
  activeSandboxId: string | null
}) {
  const activeMeta = useMemo(() => latestMessageMeta(active), [active])
  const activeDiff = activeMeta.diff
  const activeDiffKey = useMemo(
    () => diffCacheKey(activeDiff ?? undefined),
    [activeDiff]
  )
  const changeStats = useMemo(
    () => getDiffStats(activeDiff ?? undefined),
    [activeDiff]
  )
  const activeChangedTextPaths = useMemo(() => {
    const paths: string[] = []
    for (const file of changeStats.files) {
      if (file.type === "deleted" || !canPrefetchAsText(file.path)) continue
      paths.push(file.path)
      if (paths.length === MAX_PREFETCHED_CHANGED_TEXT_FILES) break
    }
    return paths
  }, [changeStats])
  const editorDiff = activeFileDiff ?? activeDiff
  const activeBranch = activeMeta.branch

  useEffect(() => {
    if (
      !activeFileCacheScope ||
      !activeSandboxId ||
      activeChangedTextPaths.length === 0
    ) {
      return
    }

    let cancelled = false
    const sandboxId = activeSandboxId
    const scope = activeFileCacheScope
    const queue = [...new Set(activeChangedTextPaths)]

    async function worker(): Promise<void> {
      if (cancelled) return
      const path = queue.shift()
      if (!path) return
      await fetchSandboxTextFileIntoCache({
        diffKey: activeDiffKey,
        path,
        sandboxId,
        scope,
      }).catch(() => undefined)
      return worker()
    }

    const timeout = window.setTimeout(() => {
      for (
        let i = 0;
        i < Math.min(TEXT_FILE_PREFETCH_CONCURRENCY, queue.length);
        i += 1
      ) {
        void worker()
      }
    }, TEXT_FILE_PREFETCH_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [
    activeChangedTextPaths,
    activeDiffKey,
    activeFileCacheScope,
    activeSandboxId,
  ])

  return {
    activeBranch,
    activeDiff,
    changeStats,
    editorDiff,
  }
}
