"use client"

import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Copy,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Loader2,
  XCircle,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { IconButton } from "@/components/ui/icon-button"
import { iconButtonVariants } from "@/components/ui/icon-button-variants"
import { cardSurfaceClass } from "@/components/ui/surface"
import type {
  ChecksSummary,
  NormalizedCheck,
  PullRequestSummary,
} from "@/lib/github/pull-requests"
import { cn } from "@/lib/shared/utils"

export function PullRequestCard({
  checks,
  pr,
}: {
  checks: ChecksSummary | null
  pr: PullRequestSummary
}) {
  const isOpen = pr.state === "open" && !pr.merged
  const status = isOpen ? mergeStatus(pr, checks) : null

  return (
    <div className={cn("overflow-hidden", cardSurfaceClass)}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <GitPullRequest
          className={cn("mt-0.5 size-4 shrink-0", prIconClass(pr))}
        />
        <div className="min-w-0 flex-1">
          <a
            href={pr.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="group block min-w-0"
          >
            <span className="block truncate text-[13px] font-medium text-foreground group-hover:underline">
              {pr.title}
            </span>
          </a>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <PrStateBadge pr={pr} />
            <span className="font-mono text-[11px] text-muted-foreground">
              #{pr.number}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="max-w-[8rem] truncate">{pr.headRef}</span>
              <span className="text-muted-foreground/50">→</span>
              <span className="max-w-[8rem] truncate">{pr.baseRef}</span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <CopyLinkButton url={pr.htmlUrl} />
          <a
            href={pr.htmlUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open pull request on GitHub"
            title="Open on GitHub"
            className={cn(iconButtonVariants({ size: "xs" }))}
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>

      {checks && checks.total > 0 ? <ChecksRollup checks={checks} /> : null}

      {status ? (
        <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2 text-[11px]">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              toneDotClass(status.tone)
            )}
          />
          <span className={cn("min-w-0 flex-1", toneTextClass(status.tone))}>
            {status.label}
          </span>
          <a
            href={pr.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Review on GitHub →
          </a>
        </div>
      ) : null}
    </div>
  )
}

type MergeTone = "success" | "danger" | "muted"

function mergeStatus(
  pr: PullRequestSummary,
  checks: ChecksSummary | null
): { blocked: boolean; label: string; tone: MergeTone } {
  if (pr.draft) {
    return {
      blocked: true,
      label: "Draft — mark ready on GitHub to merge",
      tone: "muted",
    }
  }
  const state = (pr.mergeableState ?? "").toLowerCase()
  if (pr.mergeable === false || state === "dirty") {
    return {
      blocked: true,
      label: "Conflicts must be resolved before merging",
      tone: "danger",
    }
  }
  if (state === "blocked") {
    return {
      blocked: true,
      label: "Merging is blocked by branch protection",
      tone: "danger",
    }
  }
  const failing = checks?.failing ?? 0
  const pending = checks?.pending ?? 0
  if (failing > 0) {
    return {
      blocked: false,
      label: `${failing} check${failing === 1 ? "" : "s"} failing`,
      tone: "danger",
    }
  }
  if (pending > 0) {
    return {
      blocked: false,
      label: `Waiting for ${pending} check${pending === 1 ? "" : "s"}…`,
      tone: "muted",
    }
  }
  if (state === "unstable") {
    return { blocked: false, label: "Some checks are failing", tone: "danger" }
  }
  if (state === "behind") {
    return {
      blocked: false,
      label: "Out of date with the base branch",
      tone: "muted",
    }
  }
  return { blocked: false, label: "Ready to merge", tone: "success" }
}

function toneTextClass(tone: MergeTone) {
  if (tone === "success") return "text-success"
  if (tone === "danger") return "text-destructive"
  return "text-muted-foreground"
}

function toneDotClass(tone: MergeTone) {
  if (tone === "success") return "bg-success"
  if (tone === "danger") return "bg-destructive"
  return "bg-muted-foreground/50"
}

function prIconClass(pr: PullRequestSummary) {
  if (pr.merged) return "text-success"
  if (pr.state === "closed") return "text-destructive"
  if (pr.draft) return "text-muted-foreground"
  return "text-success"
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCopiedTimer = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => clearCopiedTimer, [clearCopiedTimer])

  return (
    <IconButton
      size="xs"
      aria-label={copied ? "Link copied" : "Copy pull request link"}
      title={copied ? "Copied" : "Copy link"}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(url)
          .then(() => {
            setCopied(true)
            clearCopiedTimer()
            timerRef.current = setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => undefined)
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-success" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </IconButton>
  )
}

function ChecksRollup({ checks }: { checks: ChecksSummary }) {
  const [open, setOpen] = useState(false)
  const { failing, pending, succeeded, total } = checks
  const summary =
    failing > 0
      ? `${failing} of ${total} checks failing`
      : pending > 0
        ? `${pending} of ${total} checks running`
        : `All ${total} checks passed`

  return (
    <div className="border-t border-border/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30"
      >
        {failing > 0 ? (
          <XCircle className="size-3.5 shrink-0 text-destructive" />
        ) : pending > 0 ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-success" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-foreground/85">
          {summary}
        </span>
        {succeeded > 0 && (failing > 0 || pending > 0) ? (
          <span className="shrink-0 font-mono text-[10px] text-success tabular-nums">
            {succeeded} passed
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 px-3 pt-0.5 pb-2.5">
          <ChecksList checks={checks} />
        </div>
      ) : null}
    </div>
  )
}

function PrStateBadge({ pr }: { pr: PullRequestSummary }) {
  const { dot, label } = pr.merged
    ? { dot: "bg-success", label: "Merged" }
    : pr.state === "closed"
      ? { dot: "bg-destructive", label: "Closed" }
      : pr.draft
        ? { dot: "bg-muted-foreground/50", label: "Draft" }
        : { dot: "bg-success", label: "Open" }

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/80">
      <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
      {label}
    </span>
  )
}

function ChecksList({ checks }: { checks: ChecksSummary }) {
  return (
    <>
      {checks.checks.map((check) => (
        <div key={check.id} className="flex items-center gap-2 text-xs">
          <CheckIcon check={check} />
          <span className="min-w-0 flex-1 truncate text-foreground/85">
            {check.name}
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
        </div>
      ))}
    </>
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
