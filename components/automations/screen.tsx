"use client"

import { useQuery } from "convex/react"
import { Clock, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { AutomationComposer } from "@/components/automations/composer"
import {
  AUTOMATION_STATUS_LABEL,
  formatRelative,
  type AutomationRecord,
} from "@/components/automations/model"
import { repoLabel } from "@/components/chat/format"
import { SettingsConfirmDialog } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { cardSurfaceClass } from "@/components/ui/surface"
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

function branchLabel(automation: AutomationRecord) {
  if (automation.branchMode === "base") {
    return automation.baseBranch || "base branch"
  }
  if (automation.branchMode === "custom" && automation.branchName) {
    return automation.branchName
  }
  return "new branch"
}

function AutomationRow({
  automation,
  busy,
  editing,
  highlighted,
  onDelete,
  onEdit,
  onOpenThread,
  onRunNow,
  onToggle,
}: {
  automation: AutomationRecord
  busy: boolean
  editing: boolean
  highlighted: boolean
  onDelete: () => void
  onEdit: () => void
  onOpenThread: () => void
  onRunNow: () => void
  onToggle: (enabled: boolean) => void
}) {
  const now = Date.now()
  const schedule = shortScheduleLabel(scheduleDraftFromCron(automation.cron))
  const statusLabel = automation.lastRunStatus
    ? AUTOMATION_STATUS_LABEL[automation.lastRunStatus]
    : null
  const statusFailed =
    automation.lastRunStatus === "failed" ||
    automation.lastRunStatus === "dispatch_failed"

  return (
    <li
      className={cn(
        "group px-4 py-3 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-muted/40",
        editing && "bg-muted/40",
        highlighted && "bg-success/5"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            statusDotClass(automation)
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <button
              type="button"
              onClick={onOpenThread}
              title="Open chat"
              className="truncate text-left text-sm font-medium text-foreground outline-none hover:underline focus-visible:underline"
            >
              {automation.name}
            </button>
            {automation.enabled && automation.nextRunAt ? (
              <span className="shrink-0 text-[11px] text-muted-foreground/70 tabular-nums">
                next {formatRelative(automation.nextRunAt, now)}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
            <span className="truncate">
              {schedule} · {repoLabel(automation.repoUrl)} ·{" "}
              {branchLabel(automation)}
            </span>
            {statusLabel ? (
              <span
                className={cn("shrink-0", statusFailed && "text-destructive")}
                title={automation.lastRunError}
              >
                {automation.lastRunAt
                  ? `${statusLabel.toLowerCase()} ${formatRelative(automation.lastRunAt, now)}`
                  : statusLabel.toLowerCase()}
              </span>
            ) : null}
          </p>
          {automation.disabledReason ? (
            <p className="mt-1 text-xs text-destructive">
              {automation.disabledReason}
            </p>
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
          <IconButton
            aria-label="Edit"
            title="Edit"
            aria-pressed={editing}
            onClick={onEdit}
          >
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
        />
      </div>
    </li>
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
  const [pendingDelete, setPendingDelete] = useState<AutomationRecord | null>(
    null
  )
  const [busyId, setBusyId] = useState<Id<"automations"> | null>(null)
  const [highlightId, setHighlightId] = useState<Id<"automations"> | null>(null)
  const [actionError, setActionError] = useState("")

  const editingId = active && active !== "new" ? active._id : null

  useEffect(() => {
    if (!highlightId) return
    const timer = setTimeout(() => setHighlightId(null), 2200)
    return () => clearTimeout(timer)
  }, [highlightId])

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-2xl px-4 pt-8 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:pt-12">
          <h1 className="sr-only">Automations</h1>

          {active !== null ? (
            <AutomationComposer
              key={active === "new" ? "new" : active._id}
              automation={active === "new" ? null : active}
              defaultRepoUrl={defaultRepoUrl}
              onCancel={() => setActive(null)}
              onSaved={(automationId) => {
                setActive(null)
                setHighlightId(automationId)
              }}
            />
          ) : (
            <>
              {actionError ? (
                <p className="mb-4 text-sm text-destructive">{actionError}</p>
              ) : null}

              {automations === undefined ? (
                <ul
                  className={cn(cardSurfaceClass, "divide-y divide-border/60")}
                >
                  {[0, 1].map((index) => (
                    <li key={index} className="px-4 py-3">
                      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                      <div className="mt-2 h-3 w-64 animate-pulse rounded bg-muted/60" />
                    </li>
                  ))}
                </ul>
              ) : automations.length === 0 ? (
                <EmptyState onCreate={() => setActive("new")} />
              ) : (
                <>
                  <div className="mb-3 flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => setActive("new")}
                      className="gap-1.5"
                    >
                      <Plus className="size-4" />
                      New automation
                    </Button>
                  </div>
                  <ul
                    className={cn(
                      cardSurfaceClass,
                      "divide-y divide-border/60"
                    )}
                  >
                    {automations.map((automation) => (
                      <AutomationRow
                        key={automation._id}
                        automation={automation}
                        busy={busyId === automation._id}
                        editing={editingId === automation._id}
                        highlighted={highlightId === automation._id}
                        onDelete={() => setPendingDelete(automation)}
                        onEdit={() => setActive(automation)}
                        onOpenThread={() => onOpenThread(automation.threadId)}
                        onRunNow={() => void runNow(automation)}
                        onToggle={(enabled) => void toggle(automation, enabled)}
                      />
                    ))}
                  </ul>
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
