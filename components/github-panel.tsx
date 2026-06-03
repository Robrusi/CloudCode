"use client"

import {
  ArrowUp,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Loader2,
  Plus,
  RefreshCw,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react"
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type { FileBrowserOpenMode } from "@/components/file-browser"
import { Button } from "@/components/ui/button"
import { Checkbox as UiCheckbox } from "@/components/ui/checkbox"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Switch as UiSwitch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cardSurfaceClass } from "@/components/ui/surface"
import { getDiffStats, type DiffFileStat } from "@/lib/diff-metadata"
import type {
  ChecksSummary,
  CreatePullRequestResult,
  MergeMethod,
  NormalizedCheck,
  PullRequestSummary,
} from "@/lib/github-pull-requests"
import type { SandboxGitFile, SandboxGitStatus } from "@/lib/sandbox-git"
import { cn } from "@/lib/utils"
import { ResizeHandle } from "@/components/resize-handle"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { useResizablePanel } from "@/hooks/use-resizable-panel"

type PrEntry = PullRequestSummary & { checks: ChecksSummary | null }

type PrResponse = {
  allowedMergeMethods: MergeMethod[]
  branch: string | null
  connected: boolean
  prs: PrEntry[]
}

type BusyKind = "commit" | "commit-push" | "create" | "merge" | "push" | null

const MERGE_LABELS: Record<MergeMethod, string> = {
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
  squash: "Squash and merge",
}

const POLL_INTERVAL_MS = 8000

export function GithubPanel({
  open,
  sandboxId,
  repoUrl,
  baseBranch,
  diff,
  githubConnected,
  onClose,
  onOpenFile,
}: {
  open: boolean
  sandboxId: string | null
  repoUrl: string
  baseBranch: string
  diff?: string
  githubConnected: boolean
  onClose: () => void
  onOpenFile: (path: string, mode: FileBrowserOpenMode) => void
}) {
  const isMobile = useIsMobile()
  const { width, resizing, onResizeStart, resetWidth } = useResizablePanel({
    storageKey: "cloudcode:githubPanelWidth",
    defaultWidth: 304,
    minWidth: 240,
    maxWidth: 560,
    edge: "left",
    enabled: !isMobile,
  })
  const [status, setStatus] = useState<SandboxGitStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [prData, setPrData] = useState<PrResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<BusyKind>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState("")
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [prTitle, setPrTitle] = useState("")
  const [prBody, setPrBody] = useState("")
  const [prDraft, setPrDraft] = useState(false)
  const [compareUrl, setCompareUrl] = useState<string | null>(null)
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>("squash")
  const [deleteBranchOnMerge, setDeleteBranchOnMerge] = useState(true)

  const busyRef = useRef<BusyKind>(null)
  busyRef.current = busy

  const diffStatByPath = useMemo(() => {
    const map = new Map<string, DiffFileStat>()
    for (const file of getDiffStats(diff).files) {
      map.set(file.path, file)
      if (file.prevPath) map.set(file.prevPath, file)
    }
    return map
  }, [diff])

  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return
      try {
        const res = await fetch(
          `/api/sandbox/git/status?${new URLSearchParams({ sandboxId })}`,
          { cache: "no-store", signal }
        )
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to load git status.")
        setStatus(data as SandboxGitStatus)
        setStatusError(null)
      } catch (error) {
        if (signal?.aborted) return
        setStatusError(
          error instanceof Error ? error.message : "Failed to load git status."
        )
      }
    },
    [sandboxId]
  )

  const loadPr = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return
      try {
        const res = await fetch(
          `/api/sandbox/git/pr?${new URLSearchParams({ sandboxId })}`,
          { cache: "no-store", signal }
        )
        const data = await res.json()
        if (!res.ok)
          throw new Error(data.error ?? "Failed to load pull request.")
        setPrData(data as PrResponse)
      } catch {
        if (signal?.aborted) return
        // PR/check info is best-effort; keep the panel usable on failure.
      }
    },
    [sandboxId]
  )

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      await Promise.all([loadStatus(signal), loadPr(signal)])
      if (!signal?.aborted) setLoading(false)
    },
    [loadPr, loadStatus]
  )

  useEffect(() => {
    if (!open || !sandboxId) return
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [open, sandboxId, refresh])

  const prs = prData?.prs ?? []
  const openPrs = prs.filter((entry) => entry.state === "open" && !entry.merged)
  const shouldPoll =
    open &&
    openPrs.some(
      (entry) => (entry.checks?.pending ?? 0) > 0 || entry.mergeable === null
    )

  useEffect(() => {
    if (!shouldPoll) return
    const id = window.setInterval(() => {
      if (!busyRef.current) void loadPr()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [shouldPoll, loadPr])

  const connected = prData?.connected ?? githubConnected
  const files = status?.files ?? []
  const branch = status?.branch ?? prData?.branch ?? null
  const hasChanges = files.length > 0
  const canCommit =
    hasChanges && commitMessage.trim().length > 0 && busy === null
  const ahead = status?.ahead ?? 0
  const canPush = connected && busy === null

  const runAction = useCallback(
    async (kind: Exclude<BusyKind, null>, fn: () => Promise<void>) => {
      setBusy(kind)
      setActionError(null)
      try {
        await fn()
        await refresh()
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Something went wrong."
        )
      } finally {
        setBusy(null)
      }
    },
    [refresh]
  )

  const postJson = useCallback(async (path: string, payload: unknown) => {
    const res = await fetch(path, {
      body: JSON.stringify(payload),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error((data as { error?: string }).error ?? "Request failed.")
    }
    return data
  }, [])

  const commit = useCallback(
    (kind: "commit" | "commit-push") =>
      runAction(kind, async () => {
        if (!sandboxId) return
        await postJson("/api/sandbox/git/commit", {
          message: commitMessage.trim(),
          sandboxId,
        })
        if (kind === "commit-push") {
          await postJson("/api/sandbox/git/push", { sandboxId })
        }
        setCommitMessage("")
      }),
    [commitMessage, postJson, runAction, sandboxId]
  )

  const push = useCallback(
    () =>
      runAction("push", async () => {
        if (!sandboxId) return
        await postJson("/api/sandbox/git/push", { sandboxId })
      }),
    [postJson, runAction, sandboxId]
  )

  const openCreateForm = useCallback(() => {
    setCompareUrl(null)
    setPrTitle(defaultPrTitle(branch))
    setPrBody("")
    setPrDraft(false)
    setShowCreateForm(true)
  }, [branch])

  const createPr = useCallback(
    () =>
      runAction("create", async () => {
        if (!sandboxId) return
        // Make sure the branch exists on the remote before opening the PR.
        await postJson("/api/sandbox/git/push", { sandboxId })
        const result = (await postJson("/api/sandbox/git/pr", {
          base: baseBranch || undefined,
          body: prBody,
          draft: prDraft,
          sandboxId,
          title: prTitle.trim(),
        })) as CreatePullRequestResult
        if (result.kind === "manual") {
          setCompareUrl(result.compareUrl)
        } else {
          setShowCreateForm(false)
        }
      }),
    [baseBranch, postJson, prBody, prDraft, prTitle, runAction, sandboxId]
  )

  const merge = useCallback(
    (prNumber: number) =>
      runAction("merge", async () => {
        if (!sandboxId) return
        await postJson("/api/sandbox/git/merge", {
          deleteBranch: deleteBranchOnMerge,
          method: mergeMethod,
          number: prNumber,
          sandboxId,
        })
      }),
    [deleteBranchOnMerge, mergeMethod, postJson, runAction, sandboxId]
  )

  useEffect(() => {
    if (prData?.allowedMergeMethods?.length) {
      setMergeMethod((current) =>
        prData.allowedMergeMethods.includes(current)
          ? current
          : prData.allowedMergeMethods[0]
      )
    }
  }, [prData?.allowedMergeMethods])

  if (!open) return null

  return (
    <aside
      className="fixed inset-0 z-40 flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border/60 bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:relative md:inset-auto md:z-auto md:w-[var(--panel-width)] md:shrink-0 md:pt-0 md:pb-0"
      style={{ "--panel-width": `${width}px` } as CSSProperties}
      data-github-panel
    >
      <ResizeHandle
        edge="left"
        resizing={resizing}
        onResizeStart={onResizeStart}
        onReset={resetWidth}
        ariaLabel="Resize GitHub panel"
      />
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span className="text-sm font-medium text-foreground/85">GitHub</span>
        {loading || busy ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        <IconButton
          onClick={() => void refresh()}
          aria-label="Refresh"
          title="Refresh"
          disabled={!sandboxId || loading || busy !== null}
          className="ml-auto"
        >
          <RefreshCw className="size-3.5" />
        </IconButton>
        <IconButton onClick={onClose} aria-label="Close GitHub panel">
          <X />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!sandboxId ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-xs text-muted-foreground">No active sandbox.</p>
          </div>
        ) : statusError && !status ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-xs text-muted-foreground">{statusError}</p>
            <SecondaryButton onClick={() => void refresh()}>
              Retry
            </SecondaryButton>
          </div>
        ) : (
          <div className="px-3 pt-4 pb-4">
            <BranchRow
              branch={branch}
              baseBranch={baseBranch}
              ahead={ahead}
              behind={status?.behind ?? 0}
              upstream={status?.upstream ?? null}
            />

            {actionError ? <ErrorBanner message={actionError} /> : null}

            <ChangesSection
              files={files}
              diffStatByPath={diffStatByPath}
              onOpenFile={onOpenFile}
            />

            <CommitSection
              value={commitMessage}
              onChange={setCommitMessage}
              canCommit={canCommit}
              busy={busy}
              canPush={connected}
              onCommit={() => commit("commit")}
              onCommitAndPush={() => commit("commit-push")}
            />

            {connected && ahead > 0 ? (
              <SecondaryButton
                onClick={push}
                disabled={!canPush}
                loading={busy === "push"}
                className="mt-2 w-full"
              >
                <ArrowUp className="size-3.5" />
                Push {ahead} {ahead === 1 ? "commit" : "commits"}
              </SecondaryButton>
            ) : null}

            <PullRequestSection
              connected={connected}
              prs={prs}
              allowedMergeMethods={prData?.allowedMergeMethods ?? []}
              repoUrl={repoUrl}
              busy={busy}
              showCreateForm={showCreateForm}
              compareUrl={compareUrl}
              prTitle={prTitle}
              prBody={prBody}
              prDraft={prDraft}
              baseBranch={baseBranch}
              branch={branch}
              mergeMethod={mergeMethod}
              deleteBranchOnMerge={deleteBranchOnMerge}
              onOpenCreateForm={openCreateForm}
              onCancelCreateForm={() => setShowCreateForm(false)}
              onChangeTitle={setPrTitle}
              onChangeBody={setPrBody}
              onChangeDraft={setPrDraft}
              onCreate={createPr}
              onChangeMergeMethod={setMergeMethod}
              onChangeDeleteBranch={setDeleteBranchOnMerge}
              onMerge={merge}
            />
          </div>
        )}
      </div>
    </aside>
  )
}

function defaultPrTitle(branch: string | null) {
  if (!branch) return ""
  const last = branch.split("/").pop() ?? branch
  const words = last.replace(/[-_]+/g, " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ""
}

function SectionHeading({
  children,
  trailing,
}: {
  children: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 px-0.5 pb-2">
      <h2 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground/80 uppercase">
        {children}
      </h2>
      {trailing ? (
        <div className="ml-auto flex items-center gap-2">{trailing}</div>
      ) : null}
    </div>
  )
}

function BranchRow({
  ahead,
  baseBranch,
  behind,
  branch,
  upstream,
}: {
  ahead: number
  baseBranch: string
  behind: number
  branch: string | null
  upstream: string | null
}) {
  return (
    <div className="flex items-center gap-1.5 px-0.5 pb-3 text-xs">
      <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium text-foreground">
        {branch ?? "detached HEAD"}
      </span>
      {baseBranch ? (
        <>
          <span className="shrink-0 text-muted-foreground/50">→</span>
          <span className="truncate text-muted-foreground">{baseBranch}</span>
        </>
      ) : null}
      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {!upstream
          ? "unpushed"
          : ahead || behind
            ? `${ahead ? `↑${ahead}` : ""}${behind ? `↓${behind}` : ""}`
            : "up to date"}
      </span>
    </div>
  )
}

function ChangesSection({
  diffStatByPath,
  files,
  onOpenFile,
}: {
  diffStatByPath: Map<string, DiffFileStat>
  files: SandboxGitFile[]
  onOpenFile: (path: string, mode: FileBrowserOpenMode) => void
}) {
  return (
    <div>
      <SectionHeading
        trailing={
          files.length > 0 ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
              {files.length}
            </span>
          ) : undefined
        }
      >
        Changes
      </SectionHeading>
      <div className={cn("overflow-hidden", cardSurfaceClass)}>
        {files.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">No changes.</p>
        ) : (
          <ul>
            {files.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                stat={diffStatByPath.get(file.path)}
                onOpen={() => onOpenFile(file.path, "diff")}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function statusCodeColor(code: string) {
  if (code === "A" || code === "U") {
    return "text-success"
  }
  if (code === "D") return "text-destructive"
  return "text-muted-foreground"
}

function FileRow({
  file,
  onOpen,
  stat,
}: {
  file: SandboxGitFile
  onOpen: () => void
  stat?: DiffFileStat
}) {
  const slash = file.path.lastIndexOf("/")
  const dir = slash === -1 ? "" : file.path.slice(0, slash + 1)
  const name = slash === -1 ? file.path : file.path.slice(slash + 1)

  return (
    <li className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        title={file.path}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30"
      >
        <span
          className={cn(
            "w-3 shrink-0 text-center font-mono text-[11px] font-medium",
            statusCodeColor(file.code)
          )}
        >
          {file.code}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          {dir ? <span className="text-muted-foreground">{dir}</span> : null}
          {name}
        </span>
        {stat ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            <span className="text-success">+{stat.additions}</span>{" "}
            <span className="text-destructive">−{stat.deletions}</span>
          </span>
        ) : null}
      </button>
    </li>
  )
}

function CommitSection({
  busy,
  canCommit,
  canPush,
  onChange,
  onCommit,
  onCommitAndPush,
  value,
}: {
  busy: BusyKind
  canCommit: boolean
  canPush: boolean
  onChange: (value: string) => void
  onCommit: () => void
  onCommitAndPush: () => void
  value: string
}) {
  return (
    <div className="mt-4">
      <SectionHeading>Commit</SectionHeading>
      <div
        className={cn(
          "overflow-hidden transition-[border-color,box-shadow] focus-within:border-border focus-within:ring-2 focus-within:ring-ring/15",
          cardSurfaceClass
        )}
      >
        <Textarea
          variant="bare"
          aria-label="Commit message"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Message"
          rows={3}
          spellCheck={false}
          className="block px-3 py-2.5 text-[13px] text-foreground"
        />
        <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/30 px-2.5 py-2">
          <SecondaryButton
            onClick={onCommit}
            disabled={!canCommit}
            loading={busy === "commit"}
          >
            <GitCommitHorizontal className="size-3.5" />
            Commit
          </SecondaryButton>
          <PrimaryButton
            onClick={onCommitAndPush}
            disabled={!canCommit || !canPush}
            loading={busy === "commit-push"}
          >
            Commit &amp; Push
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

function PullRequestSection({
  allowedMergeMethods,
  baseBranch,
  branch,
  busy,
  compareUrl,
  connected,
  deleteBranchOnMerge,
  mergeMethod,
  onCancelCreateForm,
  onChangeBody,
  onChangeDeleteBranch,
  onChangeDraft,
  onChangeMergeMethod,
  onChangeTitle,
  onCreate,
  onMerge,
  onOpenCreateForm,
  prBody,
  prDraft,
  prTitle,
  prs,
  repoUrl,
  showCreateForm,
}: {
  allowedMergeMethods: MergeMethod[]
  baseBranch: string
  branch: string | null
  busy: BusyKind
  compareUrl: string | null
  connected: boolean
  deleteBranchOnMerge: boolean
  mergeMethod: MergeMethod
  onCancelCreateForm: () => void
  onChangeBody: (value: string) => void
  onChangeDeleteBranch: (value: boolean) => void
  onChangeDraft: (value: boolean) => void
  onChangeMergeMethod: (value: MergeMethod) => void
  onChangeTitle: (value: string) => void
  onCreate: () => void
  onMerge: (prNumber: number) => void
  onOpenCreateForm: () => void
  prBody: string
  prDraft: boolean
  prTitle: string
  prs: PrEntry[]
  repoUrl: string
  showCreateForm: boolean
}) {
  const hasOpen = prs.some((pr) => pr.state === "open" && !pr.merged)

  return (
    <div className="mt-4">
      <SectionHeading
        trailing={
          prs.length > 1 ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
              {prs.length}
            </span>
          ) : undefined
        }
      >
        {prs.length === 1 ? "Pull request" : "Pull requests"}
      </SectionHeading>

      {!connected ? (
        <div className={cn("px-3 py-3", cardSurfaceClass)}>
          <p className="text-xs text-muted-foreground">
            Connect GitHub in Settings to push and open pull requests.
          </p>
        </div>
      ) : showCreateForm ? (
        <CreatePrForm
          title={prTitle}
          body={prBody}
          draft={prDraft}
          base={baseBranch}
          head={branch}
          busy={busy}
          compareUrl={compareUrl}
          onChangeTitle={onChangeTitle}
          onChangeBody={onChangeBody}
          onChangeDraft={onChangeDraft}
          onCancel={onCancelCreateForm}
          onCreate={onCreate}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {prs.map((pr) => (
            <PullRequestCard
              key={pr.number}
              pr={pr}
              checks={pr.checks}
              allowedMergeMethods={allowedMergeMethods}
              mergeMethod={mergeMethod}
              deleteBranchOnMerge={deleteBranchOnMerge}
              busy={busy}
              onChangeMergeMethod={onChangeMergeMethod}
              onChangeDeleteBranch={onChangeDeleteBranch}
              onMerge={() => onMerge(pr.number)}
            />
          ))}
          {!hasOpen ? (
            <SecondaryButton onClick={onOpenCreateForm} className="w-full">
              <Plus className="size-3.5" />
              {prs.length > 0 ? "New pull request" : "Create pull request"}
            </SecondaryButton>
          ) : null}
        </div>
      )}

      <p className="mt-2.5 truncate px-0.5 text-[10px] text-muted-foreground">
        {repoLabel(repoUrl)}
      </p>
    </div>
  )
}

function CreatePrForm({
  base,
  body,
  busy,
  compareUrl,
  draft,
  head,
  onCancel,
  onChangeBody,
  onChangeDraft,
  onChangeTitle,
  onCreate,
  title,
}: {
  base: string
  body: string
  busy: BusyKind
  compareUrl: string | null
  draft: boolean
  head: string | null
  onCancel: () => void
  onChangeBody: (value: string) => void
  onChangeDraft: (value: boolean) => void
  onChangeTitle: (value: string) => void
  onCreate: () => void
  title: string
}) {
  return (
    <div
      className={cn(
        "overflow-hidden transition-[border-color,box-shadow] focus-within:border-border focus-within:ring-2 focus-within:ring-ring/15",
        cardSurfaceClass
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
        <span className="truncate text-foreground">{head ?? "HEAD"}</span>
        <span className="text-muted-foreground/50">→</span>
        <span className="truncate">{base || "default"}</span>
      </div>
      <Input
        variant="bare"
        aria-label="Pull request title"
        value={title}
        onChange={(event) => onChangeTitle(event.target.value)}
        placeholder="Title"
        spellCheck={false}
        className="block border-b border-border/60 px-3 py-2 text-[13px] font-medium text-foreground placeholder:font-medium"
      />
      <Textarea
        variant="bare"
        aria-label="Pull request description"
        value={body}
        onChange={(event) => onChangeBody(event.target.value)}
        placeholder="Description (optional)"
        rows={3}
        spellCheck={false}
        className="block px-3 py-2 text-[13px] text-foreground"
      />

      {compareUrl ? (
        <a
          href={compareUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 border-t border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-foreground/80 transition-colors hover:bg-muted"
        >
          <ExternalLink className="size-3.5 shrink-0" />
          Open on GitHub to finish creating it.
        </a>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-2.5 py-2">
        <CheckboxToggle
          checked={draft}
          label="Draft"
          onChange={onChangeDraft}
        />
        <div className="flex gap-2">
          <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={onCreate}
            disabled={!title.trim() || busy !== null}
            loading={busy === "create"}
          >
            <GitPullRequest className="size-3.5" />
            Create
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

function PullRequestCard({
  allowedMergeMethods,
  busy,
  checks,
  deleteBranchOnMerge,
  mergeMethod,
  onChangeDeleteBranch,
  onChangeMergeMethod,
  onMerge,
  pr,
}: {
  allowedMergeMethods: MergeMethod[]
  busy: BusyKind
  checks: ChecksSummary | null
  deleteBranchOnMerge: boolean
  mergeMethod: MergeMethod
  onChangeDeleteBranch: (value: boolean) => void
  onChangeMergeMethod: (value: MergeMethod) => void
  onMerge: () => void
  pr: PullRequestSummary
}) {
  const canMerge =
    pr.state === "open" && !pr.merged && busy === null && pr.mergeable !== false

  return (
    <div className={cn("overflow-hidden", cardSurfaceClass)}>
      <a
        href={pr.htmlUrl}
        target="_blank"
        rel="noreferrer"
        className="group flex items-start gap-2 px-3 py-2.5"
      >
        <GitPullRequest className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
            <span className="truncate group-hover:underline">{pr.title}</span>
            <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="mt-1 flex items-center gap-1.5">
            <PrStateBadge pr={pr} />
            <span className="font-mono text-[11px] text-muted-foreground">
              #{pr.number}
            </span>
          </span>
        </span>
      </a>

      {checks && checks.total > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-border/60 px-3 py-2.5">
          <ChecksList checks={checks} />
        </div>
      ) : null}

      {pr.state === "open" && !pr.merged ? (
        <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/30 px-3 py-2.5">
          <MergeMethodPicker
            value={mergeMethod}
            options={allowedMergeMethods}
            onChange={onChangeMergeMethod}
          />
          <Switch
            checked={deleteBranchOnMerge}
            label="Delete branch after merge"
            onChange={onChangeDeleteBranch}
          />
          <PrimaryButton
            onClick={onMerge}
            disabled={!canMerge}
            loading={busy === "merge"}
            className="w-full"
          >
            <GitMerge className="size-3.5" />
            Merge pull request
          </PrimaryButton>
          {pr.mergeable === false ? (
            <p className="text-[11px] text-destructive">
              This branch has conflicts that must be resolved.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function PrStateBadge({ pr }: { pr: PullRequestSummary }) {
  const { className, label } = pr.merged
    ? {
        className: "bg-success/10 text-success",
        label: "Merged",
      }
    : pr.state === "closed"
      ? { className: "bg-destructive/10 text-destructive", label: "Closed" }
      : pr.draft
        ? { className: "bg-muted text-muted-foreground", label: "Draft" }
        : {
            className: "bg-success/10 text-success",
            label: "Open",
          }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        className
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
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

function MergeMethodPicker({
  onChange,
  options,
  value,
}: {
  onChange: (value: MergeMethod) => void
  options: MergeMethod[]
  value: MergeMethod
}) {
  const methods = options.length > 0 ? options : (["squash"] as MergeMethod[])
  return (
    <div className="flex flex-col gap-0.5">
      {methods.map((method) => {
        const active = method === value
        return (
          <label
            key={method}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
              active
                ? "border-border/60 bg-background text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <input
              aria-label={MERGE_LABELS[method]}
              type="radio"
              name="merge-method"
              checked={active}
              onChange={() => onChange(method)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "grid size-3.5 shrink-0 place-items-center rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring/40",
                active ? "border-foreground" : "border-border/70"
              )}
            >
              {active ? (
                <span className="size-1.5 rounded-full bg-foreground" />
              ) : null}
            </span>
            {MERGE_LABELS[method]}
          </label>
        )
      })}
    </div>
  )
}

function CheckboxToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
      <UiCheckbox
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
      />
      {label}
    </label>
  )
}

function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground/80 transition-colors hover:text-foreground">
      <UiSwitch
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
      />
      {label}
    </label>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-3 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
      <TriangleAlert className="mt-px size-3 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  )
}

function PrimaryButton({
  children,
  className,
  disabled,
  loading,
  onClick,
}: {
  children: ReactNode
  className?: string
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {children}
    </Button>
  )
}

function SecondaryButton({
  children,
  className,
  disabled,
  loading,
  onClick,
}: {
  children: ReactNode
  className?: string
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {children}
    </Button>
  )
}

function repoLabel(repoUrl: string) {
  return repoUrl
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
}
