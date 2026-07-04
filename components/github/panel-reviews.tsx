"use client"

import {
  CheckCircle2,
  CircleDashed,
  CircleDot,
  MessageSquare,
  RefreshCw,
  XCircle,
  type LucideIcon,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Markdown } from "@/components/chat/markdown"
import type { FileBrowserOpenMode } from "@/components/files/browser"
import {
  EmptyTabState,
  ErrorBanner,
  ListSkeleton,
  PrimaryButton,
  SecondaryButton,
  shortAgo,
  UserAvatar,
} from "@/components/github/panel-shared"
import type { GithubPrEntry } from "@/components/github/panel-types"
import { IconButton } from "@/components/ui/icon-button"
import { Textarea } from "@/components/ui/textarea"
import { cardSurfaceClass } from "@/components/ui/surface"
import { fetchJson, postJson } from "@/lib/http/client-json"
import type {
  PullRequestReviewState,
  PullRequestTimelineItem,
} from "@/lib/github/pull-requests"
import { cn } from "@/lib/shared/utils"

const REVIEW_META: Record<
  PullRequestReviewState,
  { className: string; icon: LucideIcon; label: string }
> = {
  approved: {
    className: "text-success",
    icon: CheckCircle2,
    label: "approved",
  },
  changes_requested: {
    className: "text-destructive",
    icon: XCircle,
    label: "requested changes",
  },
  commented: {
    className: "text-muted-foreground",
    icon: MessageSquare,
    label: "reviewed",
  },
  dismissed: {
    className: "text-muted-foreground",
    icon: CircleDot,
    label: "review dismissed",
  },
  pending: {
    className: "text-muted-foreground",
    icon: CircleDashed,
    label: "started a review",
  },
}

const COLLAPSE_THRESHOLD_CHARS = 600

// Last-seen conversation per PR: paints instantly on revisit, then the
// background reload replaces it.
const conversationCache = new Map<string, PullRequestTimelineItem[]>()
const CONVERSATION_CACHE_MAX_ENTRIES = 20

function cacheConversation(key: string, items: PullRequestTimelineItem[]) {
  if (conversationCache.size >= CONVERSATION_CACHE_MAX_ENTRIES) {
    const oldest = conversationCache.keys().next().value
    if (oldest !== undefined) conversationCache.delete(oldest)
  }
  conversationCache.set(key, items)
}

export function ReviewsTab({
  connected,
  onOpenCreateForm,
  onOpenFile,
  pr,
  sandboxId,
}: {
  connected: boolean
  onOpenCreateForm: () => void
  onOpenFile: (path: string, mode: FileBrowserOpenMode) => void
  pr: GithubPrEntry | null
  sandboxId: string
}) {
  if (!pr) {
    return (
      <EmptyTabState
        icon={MessageSquare}
        action={
          connected ? (
            <SecondaryButton onClick={onOpenCreateForm}>
              Create pull request
            </SecondaryButton>
          ) : undefined
        }
      >
        The pull request conversation appears here once one is open.
      </EmptyTabState>
    )
  }

  return (
    <Conversation
      key={pr.number}
      connected={connected}
      onOpenFile={onOpenFile}
      pr={pr}
      sandboxId={sandboxId}
    />
  )
}

function Conversation({
  connected,
  onOpenFile,
  pr,
  sandboxId,
}: {
  connected: boolean
  onOpenFile: (path: string, mode: FileBrowserOpenMode) => void
  pr: GithubPrEntry
  sandboxId: string
}) {
  const cacheKey = `${sandboxId}:${pr.number}`
  const [items, setItems] = useState<PullRequestTimelineItem[] | null>(
    () => conversationCache.get(cacheKey) ?? null
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [draft, setDraft] = useState("")
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setRefreshing(true)
      setLoadError(null)
      try {
        const result = await fetchJson<{ items: PullRequestTimelineItem[] }>(
          `/api/sandbox/git/pr/conversation?${new URLSearchParams({
            number: String(pr.number),
            sandboxId,
          })}`,
          { signal },
          { fallbackError: "Failed to load the conversation." }
        )
        cacheConversation(cacheKey, result.items)
        setItems(result.items)
      } catch (error) {
        if (signal?.aborted) return
        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load the conversation."
        )
      } finally {
        if (!signal?.aborted) setRefreshing(false)
      }
    },
    [cacheKey, pr.number, sandboxId]
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const submitComment = useCallback(async () => {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    setPostError(null)
    try {
      await postJson(
        "/api/sandbox/git/pr/conversation",
        { body, number: pr.number, sandboxId },
        {},
        { fallbackError: "Failed to post the comment." }
      )
      setDraft("")
      await load()
    } catch (error) {
      setPostError(
        error instanceof Error ? error.message : "Failed to post the comment."
      )
    } finally {
      setPosting(false)
    }
  }, [draft, load, posting, pr.number, sandboxId])

  const openFileFromMarkdown = useCallback(
    (path: string) => onOpenFile(path, "file"),
    [onOpenFile]
  )

  if (!items) {
    if (loadError) {
      return (
        <div className="flex flex-col gap-3">
          <ErrorBanner message={loadError} />
          <SecondaryButton onClick={() => void load()} className="self-center">
            Retry
          </SecondaryButton>
        </div>
      )
    }
    return <ListSkeleton />
  }

  const now = Date.now()
  const hasDescription = Boolean(pr.body?.trim())

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-0.5">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground/80 uppercase">
          Conversation
        </span>
        {items.length > 0 ? (
          <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
            {items.length}
          </span>
        ) : null}
        <IconButton
          size="xs"
          aria-label="Refresh conversation"
          title="Refresh conversation"
          onClick={() => void load()}
          disabled={refreshing}
          className="ml-auto"
        >
          <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
        </IconButton>
      </div>

      {loadError ? <ErrorBanner message={loadError} /> : null}

      {!hasDescription && items.length === 0 ? (
        <EmptyTabState icon={MessageSquare}>No comments yet.</EmptyTabState>
      ) : (
        <div className={cn("overflow-hidden", cardSurfaceClass)}>
          <ul>
            {hasDescription ? (
              <TimelineRow
                action="opened this pull request"
                author={pr.authorLogin}
                avatarUrl={pr.authorAvatarUrl}
                body={pr.body}
                onOpenFileFromMarkdown={openFileFromMarkdown}
              />
            ) : null}
            {items.map((item) => (
              <TimelineItemRow
                key={item.id}
                item={item}
                now={now}
                onOpenFile={onOpenFile}
                onOpenFileFromMarkdown={openFileFromMarkdown}
              />
            ))}
          </ul>
        </div>
      )}

      {connected ? (
        <div>
          <Textarea
            aria-label="Add a comment"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a comment…"
            rows={3}
            className="text-[13px]"
          />
          {postError ? (
            <div className="mt-2">
              <ErrorBanner message={postError} />
            </div>
          ) : null}
          <div className="mt-2 flex items-center justify-end">
            <PrimaryButton
              onClick={() => void submitComment()}
              disabled={!draft.trim() || posting}
              loading={posting}
            >
              Comment
            </PrimaryButton>
          </div>
        </div>
      ) : null}

      <a
        href={pr.htmlUrl}
        target="_blank"
        rel="noreferrer"
        className="self-end px-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Open on GitHub →
      </a>
    </div>
  )
}

function timelineMeta(item: PullRequestTimelineItem): {
  action: string
  actionClassName?: string
  icon?: LucideIcon
  iconClassName?: string
} {
  if (item.kind === "review") {
    const meta = REVIEW_META[item.reviewState ?? "commented"]
    const emphatic =
      item.reviewState === "approved" ||
      item.reviewState === "changes_requested"
    return {
      action: meta.label,
      actionClassName: emphatic ? cn("font-medium", meta.className) : undefined,
      icon: meta.icon,
      iconClassName: meta.className,
    }
  }
  if (item.kind === "review-comment") {
    return { action: "commented on" }
  }
  return { action: "commented" }
}

function TimelineItemRow({
  item,
  now,
  onOpenFile,
  onOpenFileFromMarkdown,
}: {
  item: PullRequestTimelineItem
  now: number
  onOpenFile: (path: string, mode: FileBrowserOpenMode) => void
  onOpenFileFromMarkdown: (path: string) => void
}) {
  const meta = timelineMeta(item)
  return (
    <TimelineRow
      action={meta.action}
      actionClassName={meta.actionClassName}
      author={item.authorLogin}
      avatarUrl={item.authorAvatarUrl}
      body={item.body}
      htmlUrl={item.htmlUrl}
      icon={meta.icon}
      iconClassName={meta.iconClassName}
      onOpenFileFromMarkdown={onOpenFileFromMarkdown}
      path={item.path}
      onOpenPath={
        item.path ? () => onOpenFile(item.path ?? "", "diff") : undefined
      }
      time={item.timestamp !== null ? shortAgo(item.timestamp, now) : undefined}
    />
  )
}

function TimelineRow({
  action,
  actionClassName,
  author,
  avatarUrl,
  body,
  htmlUrl,
  icon: Icon,
  iconClassName,
  onOpenFileFromMarkdown,
  onOpenPath,
  path,
  time,
}: {
  action: string
  actionClassName?: string
  author?: string
  avatarUrl?: string
  body?: string
  htmlUrl?: string
  icon?: LucideIcon
  iconClassName?: string
  onOpenFileFromMarkdown: (path: string) => void
  onOpenPath?: () => void
  path?: string
  time?: string
}) {
  return (
    <li className="border-b border-border/50 px-3 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <UserAvatar url={avatarUrl} name={author} className="size-5" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {htmlUrl ? (
            <a
              href={htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              <span className="font-medium text-foreground">
                {author ?? "Someone"}
              </span>{" "}
              <span className={actionClassName}>{action}</span>
            </a>
          ) : (
            <>
              <span className="font-medium text-foreground">
                {author ?? "Someone"}
              </span>{" "}
              <span className={actionClassName}>{action}</span>
            </>
          )}
        </span>
        {Icon ? (
          <Icon className={cn("size-3.5 shrink-0", iconClassName)} />
        ) : null}
        {time ? (
          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {time}
          </span>
        ) : null}
      </div>

      <div className="pl-7">
        {path ? (
          <button
            type="button"
            onClick={onOpenPath}
            title={path}
            className="mt-1.5 block max-w-full truncate rounded-md bg-muted px-1.5 py-0.5 text-left font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {path}
          </button>
        ) : null}

        {body ? (
          <CommentBody
            onOpenFileFromMarkdown={onOpenFileFromMarkdown}
            text={body}
          />
        ) : null}
      </div>
    </li>
  )
}

function CommentBody({
  onOpenFileFromMarkdown,
  text,
}: {
  onOpenFileFromMarkdown: (path: string) => void
  text: string
}) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = text.length > COLLAPSE_THRESHOLD_CHARS

  return (
    <div className="mt-1.5">
      <div
        className={cn(
          collapsible &&
            !expanded &&
            "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
        )}
      >
        <Markdown
          text={text}
          className="space-y-2 text-xs leading-relaxed [&_h1]:text-[13px] [&_h2]:text-[13px] [&_h3]:text-xs [&_h4]:text-xs [&_table]:text-xs"
          onOpenFile={onOpenFileFromMarkdown}
          repoName={null}
        />
      </div>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  )
}
