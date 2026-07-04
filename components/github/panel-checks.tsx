"use client"

import {
  CheckCircle2,
  CircleDot,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react"

import {
  EmptyTabState,
  SecondaryButton,
} from "@/components/github/panel-shared"
import type { GithubPrEntry } from "@/components/github/panel-types"
import { cardSurfaceClass } from "@/components/ui/surface"
import type { ChecksSummary, NormalizedCheck } from "@/lib/github/pull-requests"
import { cn } from "@/lib/shared/utils"

export function ChecksTab({
  connected,
  onOpenCreateForm,
  pr,
}: {
  connected: boolean
  onOpenCreateForm: () => void
  pr: GithubPrEntry | null
}) {
  if (!pr) {
    return (
      <EmptyTabState
        icon={CircleDot}
        action={
          connected ? (
            <SecondaryButton onClick={onOpenCreateForm}>
              Create pull request
            </SecondaryButton>
          ) : undefined
        }
      >
        CI checks appear here once a pull request is open.
      </EmptyTabState>
    )
  }

  const checks = pr.checks
  if (!checks || checks.total === 0) {
    return (
      <EmptyTabState icon={CircleDot}>
        No checks reported for the latest commit.
      </EmptyTabState>
    )
  }

  return (
    <div>
      <ChecksSummaryLine checks={checks} />
      <div className={cn("overflow-hidden", cardSurfaceClass)}>
        <ul>
          {checks.checks.map((check) => (
            <li
              key={check.id}
              className="flex items-center gap-2 border-b border-border/50 px-3 py-2 last:border-b-0"
            >
              <CheckIcon check={check} />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground/85">
                {check.name}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground capitalize">
                {check.status === "completed"
                  ? (check.conclusion ?? "").replace(/_/g, " ")
                  : "running"}
              </span>
              {check.detailsUrl ? (
                <a
                  href={check.detailsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={`Details for ${check.name}`}
                >
                  <ExternalLink className="size-3" />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ChecksSummaryLine({ checks }: { checks: ChecksSummary }) {
  const { failing, pending, succeeded, total } = checks
  const summary =
    failing > 0
      ? `${failing} of ${total} checks failing`
      : pending > 0
        ? `${pending} of ${total} checks running`
        : `All ${total} checks passed`

  return (
    <div className="flex items-center gap-2 px-0.5 pb-2 text-xs">
      {failing > 0 ? (
        <XCircle className="size-3.5 shrink-0 text-destructive" />
      ) : pending > 0 ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <CheckCircle2 className="size-3.5 shrink-0 text-success" />
      )}
      <span className="min-w-0 flex-1 truncate text-foreground/85">
        {summary}
      </span>
      {succeeded > 0 && (failing > 0 || pending > 0) ? (
        <span className="shrink-0 font-mono text-[10px] text-success tabular-nums">
          {succeeded} passed
        </span>
      ) : null}
    </div>
  )
}

function CheckIcon({ check }: { check: NormalizedCheck }) {
  if (check.status !== "completed") {
    return (
      <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
    )
  }
  if (check.conclusion === "success") {
    return <CheckCircle2 className="size-3.5 shrink-0 text-success" />
  }
  if (
    check.conclusion === "neutral" ||
    check.conclusion === "skipped" ||
    check.conclusion === null
  ) {
    return <CircleDot className="size-3.5 shrink-0 text-muted-foreground" />
  }
  return <XCircle className="size-3.5 shrink-0 text-destructive" />
}
