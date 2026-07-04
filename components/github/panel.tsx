"use client"

import { GitCompareArrows, RefreshCw } from "lucide-react"
import dynamic from "next/dynamic"

import type { FileBrowserOpenMode } from "@/components/files/browser"
import {
  EmptyTabState,
  ErrorBanner,
  ListSkeleton,
  SecondaryButton,
} from "@/components/github/panel-shared"
import { useGithubPanelController } from "@/components/github/panel-controller"
import { ChangesSection, CommitSection } from "@/components/github/panel-git"
import { ChecksTab } from "@/components/github/panel-checks"
import { CreatePrForm } from "@/components/github/panel-pr-form"
import { PrHeader, PrHeaderSkeleton } from "@/components/github/panel-pr-header"
import type { GithubPrEntry } from "@/components/github/panel-types"
import { ResizableSidePanel } from "@/components/layout/resizable-side-panel"
import {
  SidePanelTabButton,
  type SidePanelTabDot,
} from "@/components/layout/side-panel-tabs"
import { IconButton } from "@/components/ui/icon-button"

const BranchDiffSection = dynamic(
  () =>
    import("@/components/github/panel-branch-diff").then(
      (mod) => mod.BranchDiffSection
    ),
  { loading: () => <ListSkeleton />, ssr: false }
)

const CommitsTab = dynamic(
  () =>
    import("@/components/github/panel-commits").then((mod) => mod.CommitsTab),
  { loading: () => <ListSkeleton />, ssr: false }
)

const ReviewsTab = dynamic(
  () =>
    import("@/components/github/panel-reviews").then((mod) => mod.ReviewsTab),
  { loading: () => <ListSkeleton />, ssr: false }
)

function checksDot(pr: GithubPrEntry | null): SidePanelTabDot | undefined {
  const checks = pr?.checks
  if (!checks || checks.total === 0) return undefined
  if (checks.failing > 0) return "danger"
  if (checks.pending > 0) return "pending"
  return "success"
}

function reviewDot(pr: GithubPrEntry | null): SidePanelTabDot | undefined {
  const reviews = pr?.reviews
  if (!reviews || reviews.length === 0) return undefined
  if (reviews.some((review) => review.state === "changes_requested")) {
    return "danger"
  }
  if (reviews.some((review) => review.state === "approved")) return "success"
  return "muted"
}

export function GithubPanel({
  open,
  sandboxId,
  repoUrl,
  baseBranch,
  githubConnected,
  onClose,
  onOpenFile,
}: {
  open: boolean
  sandboxId: string | null
  repoUrl: string
  baseBranch: string
  githubConnected: boolean
  onClose: () => void
  onOpenFile: (path: string, mode: FileBrowserOpenMode) => void
}) {
  const {
    actionError,
    ahead,
    allowedMergeMethods,
    baseDiff,
    branch,
    busy,
    canCommit,
    commit,
    commitMessage,
    compareUrl,
    connected,
    createPr,
    deleteBranchOnMerge,
    effectiveMergeMethod,
    files,
    hasChanges,
    loading,
    log,
    merge,
    onCancelCreateForm,
    onChangeBody,
    onChangeCommitMessage,
    onChangeDeleteBranchOnMerge,
    onChangeDraft,
    onChangeMergeMethod,
    onChangeTab,
    onChangeTitle,
    openCreateForm,
    prBody,
    prDraft,
    prDetailsReady,
    prReady,
    prs,
    prTitle,
    push,
    pushLabel,
    refresh,
    showCreateForm,
    status,
    statusError,
    tab,
  } = useGithubPanelController({
    baseBranch,
    githubConnected,
    open,
    sandboxId,
  })

  const currentPr = prs[0] ?? null
  const hasAnyData = status !== null || currentPr !== null

  const prPatch = baseDiff?.patch.trim() ? baseDiff.patch : null
  const changedCount = files.length

  return (
    <ResizableSidePanel
      open={open}
      title="GitHub"
      busy={loading || busy !== null}
      closeLabel="Close GitHub panel"
      resizeLabel="Resize GitHub panel"
      storageKey="cloudcode:githubPanelWidth"
      defaultWidth={304}
      minWidth={240}
      maxWidth={560}
      onClose={onClose}
      dataAttributes={{ "data-github-panel": true }}
      headerActions={
        <IconButton
          onClick={() => void refresh()}
          aria-label="Refresh"
          title="Refresh"
          disabled={!sandboxId || loading || busy !== null}
        >
          <RefreshCw className="size-3.5" />
        </IconButton>
      }
    >
      {!sandboxId ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-xs text-muted-foreground">No active sandbox.</p>
        </div>
      ) : statusError && !hasAnyData ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-xs text-muted-foreground">{statusError}</p>
          <SecondaryButton onClick={() => void refresh()}>
            Retry
          </SecondaryButton>
        </div>
      ) : (
        <>
          {hasAnyData ? (
            <PrHeader
              ahead={ahead}
              baseBranch={baseBranch}
              behind={status?.behind ?? 0}
              branch={branch}
              busy={busy}
              connected={connected}
              deleteBranchOnMerge={deleteBranchOnMerge}
              mergeMethod={effectiveMergeMethod}
              mergeMethods={allowedMergeMethods}
              morePrs={prs.slice(1)}
              onChangeDeleteBranchOnMerge={onChangeDeleteBranchOnMerge}
              onChangeMergeMethod={onChangeMergeMethod}
              onMerge={merge}
              onOpenCreateForm={openCreateForm}
              pr={currentPr}
              prDetailsReady={prDetailsReady}
              prReady={prReady}
              repoUrl={repoUrl}
              showCreateForm={showCreateForm}
              upstream={status?.upstream ?? null}
            />
          ) : (
            <PrHeaderSkeleton />
          )}

          {showCreateForm ? (
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/60 px-3 pt-3 pb-4">
              {actionError ? (
                <div className="pb-3">
                  <ErrorBanner message={actionError} />
                </div>
              ) : null}
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
                onCreate={createPr}
              />
            </div>
          ) : (
            <>
              <div className="flex h-10 shrink-0 items-stretch border-y border-border/60">
                <SidePanelTabButton
                  active={tab === "changes"}
                  label="Changes"
                  count={changedCount || undefined}
                  onClick={() => onChangeTab("changes")}
                />
                <div aria-hidden className="w-px self-stretch bg-border/60" />
                <SidePanelTabButton
                  active={tab === "review"}
                  label="Review"
                  dot={reviewDot(currentPr)}
                  onClick={() => onChangeTab("review")}
                />
                <div aria-hidden className="w-px self-stretch bg-border/60" />
                <SidePanelTabButton
                  active={tab === "checks"}
                  label="Checks"
                  dot={checksDot(currentPr)}
                  onClick={() => onChangeTab("checks")}
                />
                <div aria-hidden className="w-px self-stretch bg-border/60" />
                <SidePanelTabButton
                  active={tab === "commits"}
                  label="Commits"
                  count={
                    log && log.scope === "branch"
                      ? log.commits.length || undefined
                      : undefined
                  }
                  onClick={() => onChangeTab("commits")}
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-4">
                {actionError ? (
                  <div className="pb-3">
                    <ErrorBanner message={actionError} />
                  </div>
                ) : null}

                {tab === "changes" ? (
                  status ? (
                    <>
                      {hasChanges ? (
                        <div className="pb-4">
                          <div className="px-0.5 pb-2 text-xs text-muted-foreground">
                            Uncommitted changes
                          </div>
                          <ChangesSection
                            files={files}
                            onOpenFile={onOpenFile}
                          />
                          <CommitSection
                            value={commitMessage}
                            onChange={onChangeCommitMessage}
                            canCommit={canCommit}
                            hasChanges={hasChanges}
                            busy={busy}
                            connected={connected}
                            pushLabel={pushLabel}
                            onCommit={() => commit("commit")}
                            onCommitAndPush={() => commit("commit-push")}
                            onPush={push}
                          />
                        </div>
                      ) : pushLabel ? (
                        <div className="flex justify-end pb-4">
                          <CommitSection
                            value={commitMessage}
                            onChange={onChangeCommitMessage}
                            canCommit={canCommit}
                            hasChanges={hasChanges}
                            busy={busy}
                            connected={connected}
                            pushLabel={pushLabel}
                            onCommit={() => commit("commit")}
                            onCommitAndPush={() => commit("commit-push")}
                            onPush={push}
                          />
                        </div>
                      ) : null}

                      {prPatch ? (
                        <>
                          <BranchDiffSection
                            diff={prPatch}
                            onOpenDiff={(path) => onOpenFile(path, "diff")}
                            truncated={baseDiff?.truncated === true}
                          />
                        </>
                      ) : !hasChanges ? (
                        <EmptyTabState icon={GitCompareArrows}>
                          No changes on this branch yet.
                        </EmptyTabState>
                      ) : null}
                    </>
                  ) : (
                    <ListSkeleton />
                  )
                ) : tab === "commits" ? (
                  log ? (
                    <CommitsTab
                      baseBranch={baseBranch}
                      log={log}
                      pr={currentPr}
                      sandboxId={sandboxId}
                    />
                  ) : (
                    <ListSkeleton />
                  )
                ) : tab === "checks" ? (
                  prReady || currentPr ? (
                    <ChecksTab
                      connected={connected}
                      onOpenCreateForm={openCreateForm}
                      pr={currentPr}
                    />
                  ) : (
                    <ListSkeleton />
                  )
                ) : prReady || currentPr ? (
                  <ReviewsTab
                    connected={connected}
                    onOpenCreateForm={openCreateForm}
                    onOpenFile={onOpenFile}
                    pr={currentPr}
                    sandboxId={sandboxId}
                  />
                ) : (
                  <ListSkeleton />
                )}
              </div>
            </>
          )}
        </>
      )}
    </ResizableSidePanel>
  )
}
