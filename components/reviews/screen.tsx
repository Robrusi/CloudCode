"use client"

import { useQuery } from "convex/react"
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  LayoutTemplate,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react"
import { useRef, useState } from "react"

import {
  formatRelative,
  formatRunTime,
  repoLabel,
} from "@/components/chat/format"
import { popoverPanel } from "@/components/chat/control-styles"
import {
  RUN_STATUS_LABEL,
  runDotClass,
  type RunStatus,
} from "@/components/chat/run-status"
import { ReviewComposer } from "@/components/reviews/composer"
import { type ReviewRecord } from "@/components/reviews/model"
import { SettingsConfirmDialog } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useClickOutside } from "@/hooks/use-click-outside"
import { postJson } from "@/lib/http/client-json"
import { REVIEW_TEMPLATES, type ReviewTemplate } from "@/lib/reviews/templates"
import { cn } from "@/lib/shared/utils"

function statusDotClass(review: ReviewRecord) {
  if (!review.enabled) return "bg-muted-foreground/30"
  switch (review.lastRunStatus) {
    case "running":
      return "animate-pulse bg-foreground"
    case "succeeded":
      return "bg-success"
    case "failed":
    case "dispatch_failed":
      return "bg-destructive"
    default:
      return "bg-muted-foreground/50"
  }
}

const RECENT_RUNS_FIRST_PAGE = 5
const RECENT_RUNS_PAGE = 10

/** Lazy-loaded run history shown when a row is expanded. Starts with the
 * last 5 runs; each "Show more" loads 10 further back. */
function RecentRuns({
  onOpenThread,
  reviewId,
}: {
  onOpenThread: (threadId: Id<"threads">) => void
  reviewId: Id<"reviews">
}) {
  const [limit, setLimit] = useState(RECENT_RUNS_FIRST_PAGE)
  const result = useQuery(api.reviews.recentRuns, { limit, reviewId })
  // Hold the previous page while a larger one loads so "Show more" appends
  // instead of collapsing the list to a skeleton.
  const lastResultRef = useRef(result)
  if (result !== undefined) lastResultRef.current = result
  const view = result ?? lastResultRef.current
  const loading = result === undefined

  if (view === undefined) {
    return (
      <div className="space-y-2 py-2">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="h-3 w-44 animate-pulse rounded bg-muted/60"
          />
        ))}
      </div>
    )
  }
  if (view.runs.length === 0) {
    return (
      <p className="py-2 text-xs text-muted-foreground/70">No reviews yet.</p>
    )
  }

  return (
    <ol className="py-1">
      {view.runs.map((run) => (
        <li key={run.id} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onOpenThread(run.threadId)}
            title="Open review thread"
            className="group/run -ml-1.5 flex w-fit min-w-0 items-center gap-2 rounded-md py-1 pr-2 pl-1.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                runDotClass(run.status as RunStatus)
              )}
            />
            <span className="shrink-0 text-foreground/80">
              {run.prNumber ? `PR #${run.prNumber}` : "PR"}
            </span>
            {run.prTitle ? (
              <span className="truncate text-muted-foreground">
                {run.prTitle}
              </span>
            ) : null}
            <span className="shrink-0 text-muted-foreground/80">
              {RUN_STATUS_LABEL[run.status as RunStatus] ?? run.status}
            </span>
            <span className="shrink-0 text-muted-foreground/60 tabular-nums">
              {formatRunTime(run.createdAt)}
            </span>
          </button>
          {run.prUrl ? (
            <a
              href={run.prUrl}
              target="_blank"
              rel="noreferrer"
              title="Open pull request on GitHub"
              className="rounded-md p-1 text-muted-foreground/60 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <ExternalLink className="size-3" />
            </a>
          ) : null}
          {run.reviewCommentUrl ? (
            <a
              href={run.reviewCommentUrl}
              target="_blank"
              rel="noreferrer"
              title="Open posted review comment"
              className="rounded-md p-1 text-muted-foreground/60 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <MessageSquare className="size-3" />
            </a>
          ) : null}
        </li>
      ))}
      {view.hasMore ? (
        <li>
          <button
            type="button"
            disabled={loading}
            onClick={() => setLimit((current) => current + RECENT_RUNS_PAGE)}
            className="-ml-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
          >
            {loading ? "Loading…" : "Show more"}
          </button>
        </li>
      ) : null}
    </ol>
  )
}

/** "Run on PR…" chip: a small popover asking for the PR number, since manual
 * runs target one specific pull request. */
function RunOnPrButton({
  busy,
  onRun,
}: {
  busy: boolean
  onRun: (prNumber: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  const submit = () => {
    const prNumber = Number.parseInt(value, 10)
    if (!Number.isInteger(prNumber) || prNumber <= 0) return
    setOpen(false)
    setValue("")
    onRun(prNumber)
  }

  return (
    <div ref={ref} className="relative">
      <IconButton
        aria-label="Review a pull request now"
        title="Review a pull request now"
        disabled={busy}
        onClick={() => setOpen(!open)}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Play className="size-3.5" />
        )}
      </IconButton>
      {open ? (
        <div className={cn(popoverPanel, "top-8 right-0 w-44 p-2")}>
          <Input
            ref={(element) => element?.focus()}
            inputMode="numeric"
            aria-label="Pull request number"
            value={value}
            onChange={(event) =>
              setValue(event.target.value.replace(/[^\d]/g, ""))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                submit()
              }
            }}
            placeholder="PR number"
            className="h-8 rounded-md border-border/60 px-2.5 text-sm focus:border-border focus:ring-0"
          />
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={!value}
            className="mt-2 w-full"
          >
            Review PR
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function ReviewRow({
  busy,
  expanded,
  onDelete,
  onEdit,
  onOpenThread,
  onRunOnPr,
  onToggle,
  onToggleExpanded,
  review,
}: {
  busy: boolean
  expanded: boolean
  onDelete: () => void
  onEdit: () => void
  onOpenThread: (threadId: Id<"threads">) => void
  onRunOnPr: (prNumber: number) => void
  onToggle: (enabled: boolean) => void
  onToggleExpanded: () => void
  review: ReviewRecord
}) {
  const now = Date.now()
  const statusFailed =
    review.lastRunStatus === "failed" ||
    review.lastRunStatus === "dispatch_failed"
  const triggerLabel = review.reviewReadyForReview
    ? "Reviews opened + ready PRs"
    : "Reviews opened PRs"

  return (
    <li className="group flex items-start gap-3 py-3.5">
      <span
        aria-hidden
        className={cn(
          "mt-[7px] size-1.5 shrink-0 rounded-full",
          statusDotClass(review)
        )}
      />

      <div className={cn("min-w-0 flex-1", !review.enabled && "opacity-60")}>
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {review.name}
            </span>
            <span className="shrink-0 truncate text-sm text-muted-foreground">
              {repoLabel(review.repoUrl)}
            </span>
            <ChevronRight
              className={cn(
                "size-3 shrink-0 self-center text-muted-foreground/50 transition-transform",
                expanded && "rotate-90"
              )}
            />
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {triggerLabel}
            {statusFailed && review.lastRunAt ? (
              <span className="text-destructive">
                {" "}
                · failed {formatRelative(review.lastRunAt, now)}
              </span>
            ) : null}
          </span>
        </button>

        {review.disabledReason ? (
          <p className="mt-1 text-xs text-destructive">
            {review.disabledReason}
          </p>
        ) : null}

        {expanded ? (
          <div className="mt-1">
            <RecentRuns onOpenThread={onOpenThread} reviewId={review._id} />
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        <RunOnPrButton busy={busy} onRun={onRunOnPr} />
        <IconButton aria-label="Edit" title="Edit" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </IconButton>
        <IconButton
          aria-label="Delete"
          title="Delete"
          className="hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      <Switch
        checked={review.enabled}
        disabled={busy}
        onCheckedChange={onToggle}
        aria-label={review.enabled ? "Disable review" : "Enable review"}
        className="mt-0.5"
      />
    </li>
  )
}

/** "Templates" button + popover: prompt presets that open the composer
 * prefilled, from report-only reviews to fix-and-push. */
function TemplatesButton({
  onSelect,
}: {
  onSelect: (template: ReviewTemplate) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="gap-1.5 text-muted-foreground"
      >
        <LayoutTemplate className="size-4" />
        Templates
        <ChevronDown className="size-3 opacity-60" />
      </Button>
      {open ? (
        <div className={cn(popoverPanel, "top-9 right-0 w-72")}>
          {REVIEW_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => {
                onSelect(template)
                setOpen(false)
              }}
              className="block w-full rounded-lg px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <span className="block text-sm text-foreground">
                {template.name}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {template.description}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-8">
      <h2 className="border-b border-border/60 pb-2 text-sm font-medium text-foreground">
        {title}
      </h2>
      <ul className="divide-y divide-border/40">{children}</ul>
    </section>
  )
}

function EmptyState({
  onCreate,
  onSelectTemplate,
}: {
  onCreate: () => void
  onSelectTemplate: (template: ReviewTemplate) => void
}) {
  return (
    <div className="flex flex-col items-center pt-16 text-center">
      <div className="grid size-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <GitPullRequest className="size-5" />
      </div>
      <p className="mt-4 text-sm font-medium text-foreground">No reviews yet</p>
      <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
        Reviews run on every new pull request in a fresh sandbox and post the
        findings, proposed fixes, and a confidence score as a PR comment.
      </p>
      <div className="mt-5 flex items-center gap-2">
        <TemplatesButton onSelect={onSelectTemplate} />
        <Button size="sm" onClick={onCreate} className="gap-1.5">
          <Plus className="size-4" />
          Create review
        </Button>
      </div>
    </div>
  )
}

export function ReviewsScreen({
  defaultRepoUrl,
  onOpenThread,
}: {
  defaultRepoUrl: string
  onOpenThread: (threadId: Id<"threads">) => void
}) {
  const reviews = useQuery(api.reviews.list)
  const [active, setActive] = useState<ReviewRecord | "new" | null>(null)
  const [expandedId, setExpandedId] = useState<Id<"reviews"> | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ReviewRecord | null>(null)
  const [busyId, setBusyId] = useState<Id<"reviews"> | null>(null)
  const [actionError, setActionError] = useState("")
  // Template picked for the next "new" composer; null means a blank one.
  const [template, setTemplate] = useState<ReviewTemplate | null>(null)

  const editingId = active && active !== "new" ? active._id : null

  const openComposer = (nextTemplate: ReviewTemplate | null) => {
    setTemplate(nextTemplate)
    setActive("new")
  }

  async function runAction(
    review: ReviewRecord,
    action: () => Promise<unknown>
  ) {
    if (busyId) return
    setBusyId(review._id)
    setActionError("")
    try {
      await action()
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Review action failed."
      )
    } finally {
      setBusyId(null)
    }
  }

  const toggle = (review: ReviewRecord, enabled: boolean) =>
    runAction(review, () =>
      postJson(
        "/api/reviews/toggle",
        { enabled, reviewId: review._id },
        {},
        { fallbackError: "Unable to update review." }
      )
    )

  const runOnPr = (review: ReviewRecord, prNumber: number) =>
    runAction(review, () =>
      postJson(
        "/api/reviews/run-now",
        { prNumber, reviewId: review._id },
        {},
        { fallbackError: "Unable to run review." }
      )
    )

  const confirmDelete = async () => {
    const review = pendingDelete
    setPendingDelete(null)
    if (!review) return
    if (editingId === review._id) setActive(null)
    await runAction(review, () =>
      postJson(
        "/api/reviews/delete",
        { reviewId: review._id },
        {},
        { fallbackError: "Unable to delete review." }
      )
    )
  }

  const rowProps = (review: ReviewRecord) => ({
    busy: busyId === review._id,
    expanded: expandedId === review._id,
    onDelete: () => setPendingDelete(review),
    onEdit: () => setActive(review),
    onOpenThread,
    onRunOnPr: (prNumber: number) => void runOnPr(review, prNumber),
    onToggle: (enabled: boolean) => void toggle(review, enabled),
    onToggleExpanded: () =>
      setExpandedId((current) => (current === review._id ? null : review._id)),
    review,
  })

  const current = reviews?.filter((review) => review.enabled) ?? []
  const paused = reviews?.filter((review) => !review.enabled) ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div
          className={cn(
            "mx-auto w-full px-4 pt-8 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:pt-12",
            active !== null ? "max-w-4xl" : "max-w-2xl"
          )}
        >
          {active !== null ? (
            <ReviewComposer
              key={
                active === "new" ? `new-${template?.id ?? "blank"}` : active._id
              }
              review={active === "new" ? null : active}
              template={active === "new" ? template : null}
              defaultRepoUrl={defaultRepoUrl}
              onCancel={() => setActive(null)}
              onSaved={(reviewId) => {
                setActive(null)
                setExpandedId(reviewId)
              }}
            />
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl tracking-tight">Review</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Review new pull requests in fresh sandboxes and comment on
                    GitHub.
                  </p>
                </div>
                {reviews?.length ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <TemplatesButton onSelect={openComposer} />
                    <Button
                      size="sm"
                      onClick={() => openComposer(null)}
                      className="gap-1.5"
                    >
                      <Plus className="size-4" />
                      New review
                    </Button>
                  </div>
                ) : null}
              </div>

              {actionError ? (
                <p className="mt-4 text-sm text-destructive">{actionError}</p>
              ) : null}

              {reviews === undefined ? (
                <div className="mt-10 space-y-6">
                  {[0, 1].map((index) => (
                    <div key={index}>
                      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                      <div className="mt-2 h-3 w-64 animate-pulse rounded bg-muted/60" />
                    </div>
                  ))}
                </div>
              ) : reviews.length === 0 ? (
                <EmptyState
                  onCreate={() => openComposer(null)}
                  onSelectTemplate={openComposer}
                />
              ) : (
                <>
                  {current.length ? (
                    <Section title="Current">
                      {current.map((review) => (
                        <ReviewRow key={review._id} {...rowProps(review)} />
                      ))}
                    </Section>
                  ) : null}
                  {paused.length ? (
                    <Section title="Paused">
                      {paused.map((review) => (
                        <ReviewRow key={review._id} {...rowProps(review)} />
                      ))}
                    </Section>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {pendingDelete ? (
        <SettingsConfirmDialog
          title="Delete review?"
          description={`"${pendingDelete.name}" will stop reviewing pull requests. Its review threads are kept.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  )
}
