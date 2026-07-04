"use client"

import {
  Check,
  ChevronDown,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Loader2,
  Plus,
} from "lucide-react"
import { useRef, useState } from "react"

import { repoLabel } from "@/components/chat/format"
import { popoverPanel } from "@/components/chat/control-styles"
import { PrimaryButton } from "@/components/github/panel-shared"
import type {
  GithubPanelBusyKind,
  GithubPrEntry,
} from "@/components/github/panel-types"
import { Checkbox } from "@/components/ui/checkbox"
import { useClickOutside } from "@/hooks/use-click-outside"
import type { MergeMethod } from "@/lib/github/pull-requests"
import { cn } from "@/lib/shared/utils"

const MERGE_METHOD_LABELS: Record<MergeMethod, string> = {
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
  squash: "Squash and merge",
}

export function PrHeader({
  ahead,
  baseBranch,
  behind,
  branch,
  busy,
  connected,
  deleteBranchOnMerge,
  mergeMethod,
  mergeMethods,
  morePrs,
  onChangeDeleteBranchOnMerge,
  onChangeMergeMethod,
  onMerge,
  onOpenCreateForm,
  pr,
  prDetailsReady,
  prReady,
  repoUrl,
  showCreateForm,
  upstream,
}: {
  ahead: number
  baseBranch: string
  behind: number
  branch: string | null
  busy: GithubPanelBusyKind
  connected: boolean
  deleteBranchOnMerge: boolean
  mergeMethod: MergeMethod
  mergeMethods: MergeMethod[]
  morePrs: GithubPrEntry[]
  onChangeDeleteBranchOnMerge: (value: boolean) => void
  onChangeMergeMethod: (method: MergeMethod) => void
  onMerge: (number: number) => void
  onOpenCreateForm: () => void
  pr: GithubPrEntry | null
  prDetailsReady: boolean
  prReady: boolean
  repoUrl: string
  showCreateForm: boolean
  upstream: string | null
}) {
  const isOpenPr = Boolean(pr && pr.state === "open" && !pr.merged)
  const mergeStatus =
    pr && isOpenPr
      ? prDetailsReady
        ? prMergeStatus(pr)
        : {
            blocked: true,
            label: "Checking merge status...",
            tone: "muted" as const,
          }
      : null
  const repo = repoLabel(repoUrl)

  return (
    <div className="shrink-0 px-3.5 pt-3 pb-3">
      {repo ? (
        <p className="truncate pb-1.5 font-mono text-[10px] text-muted-foreground/70">
          {repo}
        </p>
      ) : null}

      <div className="flex items-start gap-2.5">
        {pr ? (
          <a
            href={pr.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 pt-0.5"
          >
            <span className="line-clamp-2 text-sm leading-snug font-semibold text-foreground hover:underline">
              {pr.title}{" "}
              <span className="font-normal text-muted-foreground">
                #{pr.number}
              </span>
            </span>
          </a>
        ) : (
          <span className="min-w-0 flex-1 truncate pt-1 text-sm leading-snug font-semibold text-foreground">
            {branch ?? "detached HEAD"}
          </span>
        )}

        {isOpenPr && pr ? (
          <MergeButton
            busy={busy}
            deleteBranchOnMerge={deleteBranchOnMerge}
            disabledReason={mergeStatus?.blocked ? mergeStatus.label : null}
            mergeMethod={mergeMethod}
            mergeMethods={mergeMethods}
            onChangeDeleteBranchOnMerge={onChangeDeleteBranchOnMerge}
            onChangeMergeMethod={onChangeMergeMethod}
            onMerge={() => onMerge(pr.number)}
          />
        ) : !pr && prReady && connected && !showCreateForm ? (
          <PrimaryButton onClick={onOpenCreateForm} className="shrink-0">
            <Plus className="size-3.5" />
            Create PR
          </PrimaryButton>
        ) : !pr && !prReady ? (
          <span
            aria-hidden
            className="h-7 w-20 shrink-0 animate-pulse rounded-lg bg-muted"
          />
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {pr ? <PrStatePill pr={pr} /> : null}
        <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
          {pr ? (
            <>
              <span className="truncate">{pr.headRef}</span>
              <span className="shrink-0 text-muted-foreground/50">→</span>
              <span className="max-w-24 truncate">{pr.baseRef}</span>
            </>
          ) : (
            <>
              <GitBranch className="size-3 shrink-0" />
              <span className="shrink-0 text-muted-foreground/50">→</span>
              <span className="truncate">{baseBranch || "default"}</span>
            </>
          )}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {!upstream
            ? "unpushed"
            : ahead || behind
              ? `${ahead ? `↑${ahead}` : ""}${behind ? `↓${behind}` : ""}`
              : "synced"}
        </span>
      </div>

      {mergeStatus ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px]">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              mergeStatus.tone === "success"
                ? "bg-success"
                : mergeStatus.tone === "danger"
                  ? "bg-destructive"
                  : "bg-muted-foreground/50"
            )}
          />
          <span
            className={cn(
              "min-w-0 truncate",
              mergeStatus.tone === "success"
                ? "text-success"
                : mergeStatus.tone === "danger"
                  ? "text-destructive"
                  : "text-muted-foreground"
            )}
          >
            {mergeStatus.label}
          </span>
        </div>
      ) : !connected && prReady ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Connect GitHub in Settings to push and open pull requests.
        </p>
      ) : null}

      {morePrs.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1">
          {morePrs.map((entry) => (
            <a
              key={entry.number}
              href={entry.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="group flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <PrStateIcon pr={entry} className="size-3 shrink-0" />
              <span className="shrink-0 font-mono">#{entry.number}</span>
              <span className="truncate group-hover:underline">
                {entry.title}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function PrHeaderSkeleton() {
  return (
    <div aria-hidden className="shrink-0 animate-pulse px-3.5 pt-3 pb-3">
      <div className="h-2.5 w-24 rounded bg-muted/70" />
      <div className="mt-2.5 flex items-start justify-between gap-2.5">
        <div className="h-4 w-3/5 rounded bg-muted" />
        <div className="h-7 w-20 rounded-lg bg-muted" />
      </div>
      <div className="mt-2.5 h-3 w-2/5 rounded bg-muted/70" />
    </div>
  )
}

function prStateMeta(pr: GithubPrEntry) {
  if (pr.merged) {
    return {
      className: "bg-success/10 text-success",
      icon: GitMerge,
      label: "Merged",
    }
  }
  if (pr.state === "closed") {
    return {
      className: "bg-destructive/10 text-destructive",
      icon: GitPullRequestClosed,
      label: "Closed",
    }
  }
  if (pr.draft) {
    return {
      className: "bg-muted text-muted-foreground",
      icon: GitPullRequestDraft,
      label: "Draft",
    }
  }
  return {
    className: "bg-success/10 text-success",
    icon: GitPullRequest,
    label: "Open",
  }
}

function PrStatePill({ pr }: { pr: GithubPrEntry }) {
  const meta = prStateMeta(pr)
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full py-0.5 pr-2 pl-1.5 text-[11px] font-medium",
        meta.className
      )}
    >
      <meta.icon className="size-3 shrink-0" />
      {meta.label}
    </span>
  )
}

function PrStateIcon({
  className,
  pr,
}: {
  className?: string
  pr: GithubPrEntry
}) {
  const meta = prStateMeta(pr)
  return <meta.icon className={className} />
}

type MergeTone = "danger" | "muted" | "success"

function prMergeStatus(pr: GithubPrEntry): {
  blocked: boolean
  label: string
  tone: MergeTone
} {
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
  const failing = pr.checks?.failing ?? 0
  const pending = pr.checks?.pending ?? 0
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

function MergeButton({
  busy,
  deleteBranchOnMerge,
  disabledReason,
  mergeMethod,
  mergeMethods,
  onChangeDeleteBranchOnMerge,
  onChangeMergeMethod,
  onMerge,
}: {
  busy: GithubPanelBusyKind
  deleteBranchOnMerge: boolean
  disabledReason: string | null
  mergeMethod: MergeMethod
  mergeMethods: MergeMethod[]
  onChangeDeleteBranchOnMerge: (value: boolean) => void
  onChangeMergeMethod: (method: MergeMethod) => void
  onMerge: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false))

  const merging = busy === "merge"
  const disabled = busy !== null || Boolean(disabledReason)
  const methods = mergeMethods.length > 0 ? mergeMethods : ["squash" as const]

  return (
    <div ref={menuRef} className="relative shrink-0">
      <div
        className={cn(
          "flex items-stretch overflow-hidden rounded-lg bg-foreground text-background",
          disabled && "opacity-50"
        )}
      >
        <button
          type="button"
          onClick={onMerge}
          disabled={disabled}
          title={disabledReason ?? MERGE_METHOD_LABELS[mergeMethod]}
          className="flex h-7 items-center gap-1.5 pr-2 pl-3 text-xs font-medium transition-colors outline-none hover:bg-foreground/90 focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none"
        >
          {merging ? <Loader2 className="size-3 animate-spin" /> : null}
          Merge
        </button>
        <span className="my-1.5 w-px bg-background/25" />
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          disabled={busy !== null}
          aria-label="Merge options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex h-7 items-center px-1.5 transition-colors outline-none hover:bg-foreground/90 focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none"
        >
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              menuOpen && "rotate-180"
            )}
          />
        </button>
      </div>

      {menuOpen ? (
        <div
          role="menu"
          className={cn(popoverPanel, "top-full right-0 mt-1 w-56")}
        >
          {methods.map((method) => (
            <button
              key={method}
              type="button"
              role="menuitemradio"
              aria-checked={method === mergeMethod}
              onClick={() => {
                onChangeMergeMethod(method)
                setMenuOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-xs text-foreground transition-colors outline-none hover:bg-muted focus-visible:bg-muted"
            >
              <span className="min-w-0 flex-1 truncate">
                {MERGE_METHOD_LABELS[method]}
              </span>
              {method === mergeMethod ? (
                <Check className="size-3.5 shrink-0" />
              ) : null}
            </button>
          ))}
          <div className="mx-2 my-1 border-t border-border/60" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={deleteBranchOnMerge}
            onClick={() => onChangeDeleteBranchOnMerge(!deleteBranchOnMerge)}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted"
          >
            <Checkbox
              tabIndex={-1}
              aria-hidden
              checked={deleteBranchOnMerge}
              className="pointer-events-none"
            />
            Delete branch after merge
          </button>
        </div>
      ) : null}
    </div>
  )
}
