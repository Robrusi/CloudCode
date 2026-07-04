"use client"

import { useQuery } from "convex/react"
import {
  ChevronRight,
  Clock,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react"
import { useRef, useState } from "react"

import { AutomationComposer } from "@/components/automations/composer"
import { type AutomationRecord } from "@/components/automations/model"
import {
  formatRelative,
  formatRunTime,
  repoLabel,
} from "@/components/chat/format"
import {
  RUN_STATUS_LABEL,
  runDotClass,
  type RunStatus,
} from "@/components/chat/run-status"
import { SettingsConfirmDialog } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Switch } from "@/components/ui/switch"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  scheduleDraftFromCron,
  shortScheduleLabel,
} from "@/lib/automations/schedule-draft"
import { postJson } from "@/lib/http/client-json"
import { cn } from "@/lib/shared/utils"

function statusDotClass(automation: AutomationRecord) {
  if (!automation.enabled) return "bg-muted-foreground/30"
  switch (automation.lastRunStatus) {
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
  automationId,
  onOpenThread,
}: {
  automationId: Id<"automations">
  onOpenThread: (threadId: Id<"threads">) => void
}) {
  const [limit, setLimit] = useState(RECENT_RUNS_FIRST_PAGE)
  const result = useQuery(api.automations.recentRuns, { automationId, limit })
  // Hold the previous page while a larger one loads so "Show more" appends
  // instead of collapsing the list to a skeleton.
  const lastResultRef = useRef(result)
  if (result !== undefined) lastResultRef.current = result
  const view = result ?? lastResultRef.current
  const loading = result === undefined
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
      {view.runs.map((run) => (
        <li key={run.id}>
          <button
            type="button"
            onClick={() => onOpenThread(run.threadId)}
            title="Open chat"
            className="group/run -ml-1.5 flex w-fit items-center gap-2 rounded-md py-1 pr-2 pl-1.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                runDotClass(run.status as RunStatus)
              )}
            />
            <span className="text-foreground/80">
              {RUN_STATUS_LABEL[run.status as RunStatus] ?? run.status}
            </span>
            <span className="text-muted-foreground/80 tabular-nums">
              {formatRunTime(run.createdAt)}
            </span>
            <span className="text-muted-foreground/60 tabular-nums">
              {formatRelative(run.createdAt, now)}
            </span>
          </button>
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

function AutomationRow({
  automation,
  busy,
  expanded,
  onDelete,
  onEdit,
  onOpenThread,
  onRunNow,
  onToggle,
  onToggleExpanded,
}: {
  automation: AutomationRecord
  busy: boolean
  expanded: boolean
  onDelete: () => void
  onEdit: () => void
  onOpenThread: (threadId: Id<"threads">) => void
  onRunNow: () => void
  onToggle: (enabled: boolean) => void
  onToggleExpanded: () => void
}) {
  const now = Date.now()
  const schedule = shortScheduleLabel(scheduleDraftFromCron(automation.cron))
  const statusFailed =
    automation.lastRunStatus === "failed" ||
    automation.lastRunStatus === "dispatch_failed"

  return (
    <li className="group flex items-start gap-3 py-3.5">
      <span
        aria-hidden
        className={cn(
          "mt-[7px] size-1.5 shrink-0 rounded-full",
          statusDotClass(automation)
        )}
      />

      <div
        className={cn("min-w-0 flex-1", !automation.enabled && "opacity-60")}
      >
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {automation.name}
            </span>
            <span className="shrink-0 truncate text-sm text-muted-foreground">
              {repoLabel(automation.repoUrl)}
            </span>
            <ChevronRight
              className={cn(
                "size-3 shrink-0 self-center text-muted-foreground/50 transition-transform",
                expanded && "rotate-90"
              )}
            />
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {automation.enabled && automation.nextRunAt
              ? `Next run ${formatRelative(automation.nextRunAt, now)} · ${schedule}`
              : schedule}
            {statusFailed && automation.lastRunAt ? (
              <span className="text-destructive">
                {" "}
                · failed {formatRelative(automation.lastRunAt, now)}
              </span>
            ) : null}
          </span>
        </button>

        {automation.disabledReason ? (
          <p className="mt-1 text-xs text-destructive">
            {automation.disabledReason}
          </p>
        ) : null}

        {expanded ? (
          <div className="mt-1">
            <RecentRuns
              automationId={automation._id}
              onOpenThread={onOpenThread}
            />
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        <IconButton
          aria-label="Run now"
          title="Run now"
          disabled={busy}
          onClick={onRunNow}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
        </IconButton>
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
        checked={automation.enabled}
        disabled={busy}
        onCheckedChange={onToggle}
        aria-label={
          automation.enabled ? "Disable automation" : "Enable automation"
        }
        className="mt-0.5"
      />
    </li>
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

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center pt-16 text-center">
      <div className="grid size-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <Clock className="size-5" />
      </div>
      <p className="mt-4 text-sm font-medium text-foreground">
        No automations yet
      </p>
      <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
        Automations run a prompt on a schedule in a fresh sandbox and report
        back to their own chat.
      </p>
      <Button size="sm" onClick={onCreate} className="mt-5 gap-1.5">
        <Plus className="size-4" />
        Create automation
      </Button>
    </div>
  )
}

export function AutomationsScreen({
  defaultRepoUrl,
  onOpenThread,
}: {
  defaultRepoUrl: string
  onOpenThread: (threadId: Id<"threads">) => void
}) {
  const automations = useQuery(api.automations.list)
  const [active, setActive] = useState<AutomationRecord | "new" | null>(null)
  const [expandedId, setExpandedId] = useState<Id<"automations"> | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AutomationRecord | null>(
    null
  )
  const [busyId, setBusyId] = useState<Id<"automations"> | null>(null)
  const [actionError, setActionError] = useState("")

  const editingId = active && active !== "new" ? active._id : null

  async function runAction(
    automation: AutomationRecord,
    action: () => Promise<unknown>
  ) {
    if (busyId) return
    setBusyId(automation._id)
    setActionError("")
    try {
      await action()
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Automation action failed."
      )
    } finally {
      setBusyId(null)
    }
  }

  const toggle = (automation: AutomationRecord, enabled: boolean) =>
    runAction(automation, () =>
      postJson(
        "/api/automations/toggle",
        { automationId: automation._id, enabled },
        {},
        { fallbackError: "Unable to update automation." }
      )
    )

  const runNow = (automation: AutomationRecord) =>
    runAction(automation, () =>
      postJson(
        "/api/automations/run-now",
        { automationId: automation._id },
        {},
        { fallbackError: "Unable to run automation." }
      )
    )

  const confirmDelete = async () => {
    const automation = pendingDelete
    setPendingDelete(null)
    if (!automation) return
    if (editingId === automation._id) setActive(null)
    await runAction(automation, () =>
      postJson(
        "/api/automations/delete",
        { automationId: automation._id },
        {},
        { fallbackError: "Unable to delete automation." }
      )
    )
  }

  const rowProps = (automation: AutomationRecord) => ({
    automation,
    busy: busyId === automation._id,
    expanded: expandedId === automation._id,
    onDelete: () => setPendingDelete(automation),
    onEdit: () => setActive(automation),
    onOpenThread,
    onRunNow: () => void runNow(automation),
    onToggle: (enabled: boolean) => void toggle(automation, enabled),
    onToggleExpanded: () =>
      setExpandedId((current) =>
        current === automation._id ? null : automation._id
      ),
  })

  const current = automations?.filter((automation) => automation.enabled) ?? []
  const paused = automations?.filter((automation) => !automation.enabled) ?? []

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
            <AutomationComposer
              key={active === "new" ? "new" : active._id}
              automation={active === "new" ? null : active}
              defaultRepoUrl={defaultRepoUrl}
              onCancel={() => setActive(null)}
              onSaved={(automationId) => {
                setActive(null)
                setExpandedId(automationId)
              }}
            />
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl tracking-tight">Automations</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Run prompts on a schedule in fresh sandboxes.
                  </p>
                </div>
                {automations?.length ? (
                  <Button
                    size="sm"
                    onClick={() => setActive("new")}
                    className="shrink-0 gap-1.5"
                  >
                    <Plus className="size-4" />
                    New automation
                  </Button>
                ) : null}
              </div>

              {actionError ? (
                <p className="mt-4 text-sm text-destructive">{actionError}</p>
              ) : null}

              {automations === undefined ? (
                <div className="mt-10 space-y-6">
                  {[0, 1].map((index) => (
                    <div key={index}>
                      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                      <div className="mt-2 h-3 w-64 animate-pulse rounded bg-muted/60" />
                    </div>
                  ))}
                </div>
              ) : automations.length === 0 ? (
                <EmptyState onCreate={() => setActive("new")} />
              ) : (
                <>
                  {current.length ? (
                    <Section title="Current">
                      {current.map((automation) => (
                        <AutomationRow
                          key={automation._id}
                          {...rowProps(automation)}
                        />
                      ))}
                    </Section>
                  ) : null}
                  {paused.length ? (
                    <Section title="Paused">
                      {paused.map((automation) => (
                        <AutomationRow
                          key={automation._id}
                          {...rowProps(automation)}
                        />
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
          title="Delete automation?"
          description={`"${pendingDelete.name}" will stop running. Its chat and run history are kept.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  )
}
