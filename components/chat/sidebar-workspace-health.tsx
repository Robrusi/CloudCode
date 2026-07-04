"use client"

import {
  Activity,
  Archive,
  CirclePause,
  GitBranch,
  History,
  LaptopMinimal,
  type LucideIcon,
  ListChecks,
} from "lucide-react"
import { useMemo } from "react"

import {
  relativeTime,
  summarizeWorkspaceHealth,
  type SidebarChat,
  type WorkspaceHealthLevel,
} from "@/components/chat/sidebar-model"
import { cn } from "@/lib/shared/utils"

const LEVEL_COPY: Record<
  WorkspaceHealthLevel,
  { accent: string; label: string; summary: string }
> = {
  active: {
    accent: "bg-success",
    label: "Active",
    summary: "Work is currently moving",
  },
  attention: {
    accent: "bg-chart-3",
    label: "Review",
    summary: "Paused or stale work needs a pass",
  },
  empty: {
    accent: "bg-muted-foreground/40",
    label: "Empty",
    summary: "Start a chat to build a signal",
  },
  idle: {
    accent: "bg-chart-2",
    label: "Calm",
    summary: "No live work needs attention",
  },
}

export function SidebarWorkspaceHealth({ chats }: { chats: SidebarChat[] }) {
  const summary = useMemo(() => summarizeWorkspaceHealth(chats), [chats])
  const copy = LEVEL_COPY[summary.level]
  const latestLabel = summary.latestActivityAt
    ? relativeTime(summary.latestActivityAt)
    : "No activity yet"
  const activeShare =
    summary.totalChats === 0
      ? 0
      : Math.min(
          100,
          Math.round((summary.attentionCount / summary.totalChats) * 100)
        )

  return (
    <section
      aria-label="Workspace health"
      className="mx-2 mt-3 rounded-lg border border-border/60 bg-background/45 p-3 shadow-[0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn("size-2 rounded-full", copy.accent)}
              aria-hidden="true"
            />
            <h2 className="truncate text-[0.75rem] font-medium text-foreground">
              Workspace health
            </h2>
          </div>
          <p className="mt-1 text-[0.6875rem] leading-4 text-muted-foreground">
            {copy.summary}
          </p>
        </div>
        <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
          {copy.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <HealthMetric
          icon={Activity}
          label="Runs"
          value={summary.pendingCount}
          active={summary.pendingCount > 0}
        />
        <HealthMetric
          icon={LaptopMinimal}
          label="Sandboxes"
          value={summary.runningSandboxCount}
          active={summary.runningSandboxCount > 0}
        />
        <HealthMetric
          icon={Archive}
          label="Stale"
          value={summary.staleCount}
          active={summary.staleCount > 0}
        />
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full min-w-1 rounded-full transition-[width]",
            copy.accent
          )}
          style={{ width: `${summary.totalChats === 0 ? 8 : activeShare}%` }}
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[0.6875rem]">
        <DetailRow icon={GitBranch} label="Repos" value={summary.repoCount} />
        <DetailRow
          icon={ListChecks}
          label="Automations"
          value={summary.automationCount}
        />
        <DetailRow
          icon={CirclePause}
          label="Paused"
          value={summary.stoppedSandboxCount}
        />
        <DetailRow icon={History} label="Latest" value={latestLabel} />
      </dl>
    </section>
  )
}

function HealthMetric({
  active,
  icon: Icon,
  label,
  value,
}: {
  active: boolean
  icon: LucideIcon
  label: string
  value: number
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border px-2 py-1.5",
        active
          ? "border-success/30 bg-success/10 text-foreground"
          : "border-border/60 bg-muted/30 text-muted-foreground"
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <Icon className="size-3 shrink-0" />
        <span className="text-[0.75rem] font-medium tabular-nums">{value}</span>
      </div>
      <div className="mt-1 truncate text-[0.625rem]">{label}</div>
    </div>
  )
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: number | string
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
      <Icon className="size-3 shrink-0" />
      <dt className="shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-foreground/85">{value}</dd>
    </div>
  )
}
