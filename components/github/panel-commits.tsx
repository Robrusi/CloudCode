"use client"

import { ChevronRight, GitCommitHorizontal } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { CommitDiffView } from "@/components/github/panel-commit-diff"
import {
  EmptyTabState,
  ErrorBanner,
  ListSkeleton,
  SecondaryButton,
  shortAgo,
  UserAvatar,
} from "@/components/github/panel-shared"
import type {
  GithubPrEntry,
  PanelCommit,
} from "@/components/github/panel-types"
import { cardSurfaceClass } from "@/components/ui/surface"
import { fetchJson } from "@/lib/http/client-json"
import type { PullRequestCommit } from "@/lib/github/pull-requests"
import type { SandboxGitLog } from "@/lib/sandbox/git"
import { cn } from "@/lib/shared/utils"

const DAY_MS = 86_400_000

const GROUP_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
})

const GROUP_DATE_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
})

function startOfDay(ms: number) {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function groupLabel(timestamp: number | null, now: number) {
  if (timestamp === null) return "Commits"
  const day = startOfDay(timestamp)
  const today = startOfDay(now)
  if (day === today) return "Commits today"
  if (day === today - DAY_MS) return "Commits yesterday"
  const format =
    new Date(timestamp).getFullYear() === new Date(now).getFullYear()
      ? GROUP_DATE_FORMAT
      : GROUP_DATE_YEAR_FORMAT
  return `Commits on ${format.format(timestamp)}`
}

function groupCommits(commits: PanelCommit[], now: number) {
  const groups: Array<{ commits: PanelCommit[]; label: string }> = []
  for (const commit of commits) {
    const label = groupLabel(commit.timestamp, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) {
      last.commits.push(commit)
    } else {
      groups.push({ commits: [commit], label })
    }
  }
  return groups
}

// PR commits only change when the head moves, so cache by head SHA: revisits
// paint instantly and nothing refetches until a new commit is pushed.
const prCommitsCache = new Map<string, PullRequestCommit[]>()
const PR_COMMITS_CACHE_MAX_ENTRIES = 10

function cachePrCommits(key: string, commits: PullRequestCommit[]) {
  if (prCommitsCache.size >= PR_COMMITS_CACHE_MAX_ENTRIES) {
    const oldest = prCommitsCache.keys().next().value
    if (oldest !== undefined) prCommitsCache.delete(oldest)
  }
  prCommitsCache.set(key, commits)
}

export function CommitsTab({
  baseBranch,
  log,
  pr,
  sandboxId,
}: {
  baseBranch: string
  log: SandboxGitLog
  pr: GithubPrEntry | null
  sandboxId: string
}) {
  const [selected, setSelected] = useState<PanelCommit | null>(null)

  if (selected) {
    return (
      <CommitDiffView
        commit={selected}
        sandboxId={sandboxId}
        onBack={() => setSelected(null)}
      />
    )
  }

  if (pr) {
    return (
      <PrCommitsList pr={pr} sandboxId={sandboxId} onSelect={setSelected} />
    )
  }

  if (log.commits.length === 0) {
    return (
      <EmptyTabState icon={GitCommitHorizontal}>
        No commits yet on this branch.
      </EmptyTabState>
    )
  }

  return (
    <CommitGroups
      commits={log.commits}
      note={
        log.scope === "recent" && baseBranch
          ? `Nothing ahead of ${baseBranch} — showing recent history.`
          : null
      }
      onSelect={setSelected}
    />
  )
}

function PrCommitsList({
  onSelect,
  pr,
  sandboxId,
}: {
  onSelect: (commit: PanelCommit) => void
  pr: GithubPrEntry
  sandboxId: string
}) {
  const cacheKey = `${sandboxId}:${pr.number}:${pr.headSha}`
  const [commits, setCommits] = useState<PullRequestCommit[] | null>(
    () => prCommitsCache.get(cacheKey) ?? null
  )
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null)
      try {
        const result = await fetchJson<{ commits: PullRequestCommit[] }>(
          `/api/sandbox/git/pr/commits?${new URLSearchParams({
            number: String(pr.number),
            sandboxId,
          })}`,
          { signal },
          { fallbackError: "Failed to load the pull request commits." }
        )
        cachePrCommits(cacheKey, result.commits)
        setCommits(result.commits)
      } catch (loadError) {
        if (signal?.aborted) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load the pull request commits."
        )
      }
    },
    [cacheKey, pr.number, sandboxId]
  )

  useEffect(() => {
    if (prCommitsCache.has(cacheKey)) return
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [cacheKey, load])

  if (!commits) {
    if (error) {
      return (
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          <SecondaryButton onClick={() => void load()} className="self-center">
            Retry
          </SecondaryButton>
        </div>
      )
    }
    return <ListSkeleton />
  }

  if (commits.length === 0) {
    return (
      <EmptyTabState icon={GitCommitHorizontal}>
        No commits on this pull request yet.
      </EmptyTabState>
    )
  }

  return <CommitGroups commits={commits} note={null} onSelect={onSelect} />
}

function CommitGroups({
  commits,
  note,
  onSelect,
}: {
  commits: PanelCommit[]
  note: string | null
  onSelect: (commit: PanelCommit) => void
}) {
  const now = Date.now()
  const groups = groupCommits(commits, now)

  return (
    <div className="flex flex-col gap-4">
      {note ? (
        <p className="px-0.5 text-[11px] text-muted-foreground">{note}</p>
      ) : null}

      {groups.map((group, index) => (
        <div key={`${group.label}:${index}`}>
          <div className="flex items-center gap-1.5 px-0.5 pb-2 text-xs text-muted-foreground">
            <GitCommitHorizontal className="size-3.5 shrink-0" />
            {group.label}
          </div>
          <div className={cn("overflow-hidden", cardSurfaceClass)}>
            <ul>
              {group.commits.map((commit) => (
                <CommitRow
                  key={commit.sha}
                  commit={commit}
                  now={now}
                  onSelect={() => onSelect(commit)}
                />
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  )
}

function CommitRow({
  commit,
  now,
  onSelect,
}: {
  commit: PanelCommit
  now: number
  onSelect: () => void
}) {
  return (
    <li className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        onClick={onSelect}
        title={commit.subject}
        className="group/commit w-full px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted/30 focus-visible:bg-muted/30"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
            {commit.subject || commit.shortSha}
          </span>
          {commit.timestamp !== null ? (
            <span className="shrink-0 pt-px text-[11px] text-muted-foreground tabular-nums">
              {shortAgo(commit.timestamp, now)}
            </span>
          ) : null}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <UserAvatar
            url={commit.authorAvatarUrl}
            name={commit.authorName}
            className="size-4"
          />
          <span className="font-mono text-[11px] text-muted-foreground">
            {commit.shortSha}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums">
            {commit.filesChanged > 0 ? (
              <>
                <span className="text-success">+{commit.additions}</span>
                <span className="text-destructive">−{commit.deletions}</span>
                <span className="text-muted-foreground">
                  {commit.filesChanged}{" "}
                  {commit.filesChanged === 1 ? "file" : "files"}
                </span>
              </>
            ) : null}
          </span>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover/commit:text-muted-foreground" />
        </div>
      </button>
    </li>
  )
}
