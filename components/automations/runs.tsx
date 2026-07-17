"use client"

import { useQuery } from "convex/react"
import { History } from "lucide-react"
import { useRef, useState } from "react"

import {
  formatRelative,
  formatRunTime,
  formatTimeOfDay,
  formatWorkedDuration,
} from "@/components/chat/format"
import {
  RUN_STATUS_LABEL,
  runDotClass,
  type RunStatus,
} from "@/components/chat/run-status"
import { UnderlineTabs } from "@/components/ui/underline-tabs"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/shared/utils"

const RECENT_RUNS_FIRST_PAGE = 5
const RECENT_RUNS_PAGE = 10
const RUNS_FEED_FIRST_PAGE = 20
const RUNS_FEED_PAGE = 20

type RunListItem = {
  createdAt: number
  error?: string
  finishedAt?: number
  startedAt?: number
  status: string
  threadId: Id<"threads">
}

/** Holds the previous result while a larger page loads so "Show more"
 * appends instead of collapsing the list to a skeleton. A changed `key`
 * drops the held value, so e.g. switching status filters shows a skeleton
 * instead of the previous filter's rows. */
function useHeldQuery<T>(result: T | undefined, key?: unknown) {
  const lastRef = useRef<{ key: unknown; value: T | undefined }>({
    key,
    value: result,
  })
  if (lastRef.current.key !== key) lastRef.current = { key, value: undefined }
  if (result !== undefined) lastRef.current = { key, value: result }
  return {
    loading: result === undefined,
    view: result ?? lastRef.current.value,
  }
}

/** Wall-clock duration of a finished run; null while queued or running. */
function runDurationLabel(run: RunListItem) {
  if (!run.finishedAt) return null
  return formatWorkedDuration(run.finishedAt - (run.startedAt ?? run.createdAt))
}

function runErrorLine(run: RunListItem) {
  return run.status === "failed" && run.error ? run.error : null
}

/** Lazy-loaded run history shown when an automation row is expanded. Starts
 * with the last 5 runs; each "Show more" loads 10 further back. */
export function RecentRuns({
  automationId,
  onOpenThread,
}: {
  automationId: Id<"automations">
  onOpenThread: (threadId: Id<"threads">) => void
}) {
  const [limit, setLimit] = useState(RECENT_RUNS_FIRST_PAGE)
  const { loading, view } = useHeldQuery(
    useQuery(api.automations.recentRuns, { automationId, limit })
  )
  const now = Date.now()

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
    return <p className="py-2 text-xs text-muted-foreground/70">No runs yet.</p>
  }

  return (
    <ol className="py-1">
      {view.runs.map((run) => {
        const duration = runDurationLabel(run)
        const error = runErrorLine(run)
        return (
          <li key={run.id}>
            <button
              type="button"
              onClick={() => onOpenThread(run.threadId)}
              title="Open chat"
              className="group/run -ml-1.5 flex w-full flex-col gap-0.5 rounded-md px-1.5 py-1 text-left text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <span className="flex w-full items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    runDotClass(run.status as RunStatus)
                  )}
                />
                <span className="flex-1 text-foreground/80">
                  {RUN_STATUS_LABEL[run.status as RunStatus] ?? run.status}
                </span>
                {duration ? (
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {duration}
                  </span>
                ) : null}
                <span className="shrink-0 text-muted-foreground/80 tabular-nums">
                  {formatRunTime(run.createdAt)}
                </span>
                <span className="shrink-0 text-muted-foreground/60 tabular-nums">
                  {formatRelative(run.createdAt, now)}
                </span>
              </span>
              {error ? (
                <span className="line-clamp-1 w-full pl-3.5 text-destructive/80">
                  {error}
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
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

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
})
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
})

function dayLabel(ms: number, now: number) {
  const date = new Date(ms)
  const today = new Date(now)
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayDiff = Math.round(
    (startOfDay(today) - startOfDay(date)) / 86_400_000
  )
  if (dayDiff === 0) return "Today"
  if (dayDiff === 1) return "Yesterday"
  return date.getFullYear() === today.getFullYear()
    ? DAY_FORMAT.format(ms)
    : DAY_YEAR_FORMAT.format(ms)
}

type RunsFilter = "all" | "succeeded" | "failed" | "active" | "canceled"

const RUNS_FILTERS: Array<{ label: string; value: RunsFilter }> = [
  { label: "All", value: "all" },
  { label: "Succeeded", value: "succeeded" },
  { label: "Failed", value: "failed" },
  { label: "Active", value: "active" },
  { label: "Canceled", value: "canceled" },
]

const FILTER_EMPTY: Record<Exclude<RunsFilter, "all">, string> = {
  active: "Nothing is running right now.",
  canceled: "No canceled runs.",
  failed: "No failed runs.",
  succeeded: "No successful runs yet.",
}

type FeedRun = {
  automationName: string
  createdAt: number
  error?: string
  finishedAt?: number
  id: string
  startedAt?: number
  status: string
  threadId: Id<"threads">
}

function isActiveRunStatus(status: string) {
  return status !== "succeeded" && status !== "failed" && status !== "canceled"
}

/** Success stays wordless (the green dot carries it); every other state gets
 * a quiet word so failures and in-flight runs read at a glance. */
function runStatusWord(status: string) {
  switch (status) {
    case "succeeded":
      return null
    case "failed":
      return { className: "text-destructive", text: "Failed" }
    case "canceled":
      return { className: "text-muted-foreground/70", text: "Canceled" }
    case "canceling":
      return { className: "text-muted-foreground", text: "Canceling" }
    case "queued":
      return { className: "text-muted-foreground", text: "Queued" }
    default:
      return { className: "text-muted-foreground", text: "Running" }
  }
}

function FeedRunRow({
  now,
  onOpen,
  run,
}: {
  now: number
  onOpen: () => void
  run: FeedRun
}) {
  // Finished runs show their duration; in-flight ones the time elapsed so far.
  const duration =
    runDurationLabel(run) ??
    (isActiveRunStatus(run.status)
      ? formatWorkedDuration(now - (run.startedAt ?? run.createdAt))
      : null)
  const error = runErrorLine(run)
  const word = runStatusWord(run.status)

  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open chat"
      className="group/run flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      <span className="flex w-full items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            runDotClass(run.status as RunStatus)
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {run.automationName}
        </span>
        {word ? (
          <span className={cn("shrink-0 text-xs", word.className)}>
            {word.text}
          </span>
        ) : (
          <span className="sr-only">Succeeded</span>
        )}
        <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {duration}
        </span>
        <span className="w-16 shrink-0 text-right text-xs text-muted-foreground/60 tabular-nums">
          {formatTimeOfDay(run.createdAt)}
        </span>
      </span>
      {error ? (
        <span className="line-clamp-1 w-full pl-4 text-xs text-destructive/75">
          {error}
        </span>
      ) : null}
    </button>
  )
}

function FeedSection({
  label,
  first,
  now,
  onOpenThread,
  runs,
}: {
  label: string
  first: boolean
  now: number
  onOpenThread: (threadId: Id<"threads">) => void
  runs: FeedRun[]
}) {
  return (
    <section className={first ? "mt-6" : "mt-8"}>
      <h2 className="border-b border-border/60 pb-2 text-sm font-medium text-foreground">
        {label}
      </h2>
      <ol className="-mx-2 mt-1">
        {runs.map((run) => (
          <li key={run.id}>
            <FeedRunRow
              now={now}
              onOpen={() => onOpenThread(run.threadId)}
              run={run}
            />
          </li>
        ))}
      </ol>
    </section>
  )
}

function FeedSkeletonRows() {
  return (
    <div className="mt-8 space-y-4">
      {["w-2/5", "w-1/2", "w-1/3"].map((width) => (
        <div key={width} className="flex items-center gap-2.5">
          <span className="size-1.5 shrink-0 rounded-full bg-muted" />
          <span
            className={cn("h-3 animate-pulse rounded bg-muted/60", width)}
          />
          <span className="ml-auto h-3 w-16 animate-pulse rounded bg-muted/40" />
        </div>
      ))}
    </div>
  )
}

/** Cross-automation run history for the Runs view: quiet status filters and
 * day-grouped rows, with active runs pinned on top. */
export function AutomationRunsFeed({
  onOpenThread,
}: {
  onOpenThread: (threadId: Id<"threads">) => void
}) {
  const [filter, setFilter] = useState<RunsFilter>("all")
  const [limit, setLimit] = useState(RUNS_FEED_FIRST_PAGE)
  // The unfiltered query feeds the filter counts; a second, filtered query
  // drives the list so "Failed" digs into history server-side instead of
  // just hiding rows from the loaded page.
  const statsResult = useQuery(api.automations.runsFeed, {
    limit: filter === "all" ? limit : RUNS_FEED_FIRST_PAGE,
  })
  const filteredResult = useQuery(
    api.automations.runsFeed,
    filter === "all" ? "skip" : { limit, status: filter }
  )
  const stats = useHeldQuery(statsResult)
  const list = useHeldQuery(
    filter === "all" ? statsResult : filteredResult,
    filter
  )
  const now = Date.now()

  const selectFilter = (value: RunsFilter) => {
    setFilter(value)
    setLimit(RUNS_FEED_FIRST_PAGE)
  }

  if (stats.view === undefined) {
    return <FeedSkeletonRows />
  }
  if (stats.view.runs.length === 0) {
    return (
      <div className="flex flex-col items-center pt-16 text-center">
        <div className="grid size-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <History className="size-5" />
        </div>
        <p className="mt-4 text-sm font-medium text-foreground">No runs yet</p>
        <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
          Every automation run lands here with its outcome and duration. Fire
          one with “Run now” to see it live.
        </p>
      </div>
    )
  }

  const counts: Record<RunsFilter, number> = {
    active: 0,
    all: stats.view.runs.length,
    canceled: 0,
    failed: 0,
    succeeded: 0,
  }
  for (const run of stats.view.runs) {
    if (run.status === "succeeded") counts.succeeded += 1
    else if (run.status === "failed") counts.failed += 1
    else if (run.status === "canceled") counts.canceled += 1
    else counts.active += 1
  }

  const listRuns = list.view?.runs
  const activeRuns =
    filter === "all" && listRuns
      ? listRuns.filter((run) => isActiveRunStatus(run.status))
      : []
  const finishedRuns = listRuns
    ? filter === "all"
      ? listRuns.filter((run) => !isActiveRunStatus(run.status))
      : listRuns
    : []
  const sections: { label: string; runs: FeedRun[] }[] = []
  for (const run of finishedRuns) {
    const label = dayLabel(run.createdAt, now)
    const last = sections[sections.length - 1]
    if (last && last.label === label) last.runs.push(run)
    else sections.push({ label, runs: [run] })
  }

  return (
    <div className="mt-6">
      <UnderlineTabs
        label="Filter runs by status"
        value={filter}
        onChange={selectFilter}
        options={RUNS_FILTERS.map((entry) => ({
          count:
            entry.value === "all"
              ? undefined
              : counts[entry.value] || undefined,
          label: entry.label,
          value: entry.value,
        }))}
      />

      {list.view === undefined ? (
        <FeedSkeletonRows />
      ) : list.view.runs.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {filter === "all" ? "No runs yet." : FILTER_EMPTY[filter]}
        </p>
      ) : (
        <>
          {activeRuns.length > 0 ? (
            <FeedSection
              label="Active"
              first
              now={now}
              onOpenThread={onOpenThread}
              runs={activeRuns}
            />
          ) : null}
          {sections.map((section, sectionIndex) => (
            <FeedSection
              key={section.label}
              label={section.label}
              first={sectionIndex === 0 && activeRuns.length === 0}
              now={now}
              onOpenThread={onOpenThread}
              runs={section.runs}
            />
          ))}
          {list.view.hasMore ? (
            <button
              type="button"
              disabled={list.loading}
              onClick={() => setLimit((current) => current + RUNS_FEED_PAGE)}
              className="mt-3 -ml-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
            >
              {list.loading ? "Loading…" : "Show more"}
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}
