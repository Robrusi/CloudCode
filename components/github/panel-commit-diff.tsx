"use client"

import { ArrowLeft } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { DiffList } from "@/components/diff/changed-files"
import {
  CopyIconButton,
  EmptyTabState,
  ErrorBanner,
  ListSkeleton,
  SecondaryButton,
  UserAvatar,
} from "@/components/github/panel-shared"
import type { PanelCommit } from "@/components/github/panel-types"
import { fetchJson } from "@/lib/http/client-json"
import type { SandboxCommitDiff } from "@/lib/sandbox/git"

// Commits are immutable, so their diffs can be cached for the session.
const diffCache = new Map<string, SandboxCommitDiff>()
const DIFF_CACHE_MAX_ENTRIES = 30

function cacheDiff(key: string, diff: SandboxCommitDiff) {
  if (diffCache.size >= DIFF_CACHE_MAX_ENTRIES) {
    const oldest = diffCache.keys().next().value
    if (oldest !== undefined) diffCache.delete(oldest)
  }
  diffCache.set(key, diff)
}

export function CommitDiffView({
  commit,
  onBack,
  sandboxId,
}: {
  commit: PanelCommit
  onBack: () => void
  sandboxId: string
}) {
  const cacheKey = `${sandboxId}:${commit.sha}`
  const [diff, setDiff] = useState<SandboxCommitDiff | null>(
    () => diffCache.get(cacheKey) ?? null
  )
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null)
      try {
        const result = await fetchJson<SandboxCommitDiff>(
          `/api/sandbox/git/show?${new URLSearchParams({
            sandboxId,
            sha: commit.sha,
          })}`,
          { signal },
          { fallbackError: "Failed to load the commit diff." }
        )
        cacheDiff(cacheKey, result)
        setDiff(result)
      } catch (loadError) {
        if (signal?.aborted) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load the commit diff."
        )
      }
    },
    [cacheKey, commit.sha, sandboxId]
  )

  useEffect(() => {
    if (diffCache.has(cacheKey)) return
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [cacheKey, load])

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-2 flex h-7 items-center gap-1.5 rounded-lg pr-2.5 pl-1.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <ArrowLeft className="size-3.5" />
        Commits
      </button>

      <div className="px-0.5 pb-3">
        <p className="text-[13px] leading-snug font-medium break-words text-foreground">
          {commit.subject || commit.shortSha}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <UserAvatar
            url={commit.authorAvatarUrl}
            name={commit.authorName}
            className="size-4"
          />
          {commit.authorName ? (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {commit.authorName}
            </span>
          ) : null}
          <span className="font-mono text-[11px] text-muted-foreground">
            {commit.shortSha}
          </span>
          <CopyIconButton label="Copy commit SHA" value={commit.sha} />
          {commit.filesChanged > 0 ? (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums">
              <span className="text-success">+{commit.additions}</span>
              <span className="text-destructive">−{commit.deletions}</span>
              <span className="text-muted-foreground">
                {commit.filesChanged}{" "}
                {commit.filesChanged === 1 ? "file" : "files"}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          <SecondaryButton onClick={() => void load()} className="self-center">
            Retry
          </SecondaryButton>
        </div>
      ) : !diff ? (
        <ListSkeleton />
      ) : !diff.diff.trim() ? (
        <EmptyTabState>
          This commit has no diff (likely a merge commit).
        </EmptyTabState>
      ) : (
        <>
          {diff.truncated ? (
            <p className="pb-2 text-[11px] text-muted-foreground">
              Large commit — showing a truncated diff.
            </p>
          ) : null}
          <DiffList diff={diff.diff} diffStyle="unified" />
        </>
      )}
    </div>
  )
}
