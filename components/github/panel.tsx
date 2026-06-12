"use client"

import { Loader2, RefreshCw, X } from "lucide-react"
import type { CSSProperties } from "react"

import type { FileBrowserOpenMode } from "@/components/files/browser"
import { ErrorBanner, SecondaryButton } from "@/components/github/panel-shared"
import { useGithubPanelController } from "@/components/github/panel-controller"
import {
  BranchRow,
  ChangesSection,
  CommitSection,
} from "@/components/github/panel-git"
import { PullRequestSection } from "@/components/github/panel-prs"
import { ResizeHandle } from "@/components/layout/resize-handle"
import { IconButton } from "@/components/ui/icon-button"

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
  const {
    actionError,
    ahead,
    branch,
    busy,
    canCommit,
    commit,
    commitMessage,
    compareUrl,
    connected,
    createPr,
    diffStatByPath,
    files,
    hasChanges,
    loading,
    onCancelCreateForm,
    onChangeBody,
    onChangeCommitMessage,
    onChangeDraft,
    onChangeTitle,
    onResizeStart,
    openCreateForm,
    prBody,
    prDraft,
    prs,
    prTitle,
    push,
    pushLabel,
    refresh,
    resetWidth,
    resizing,
    showCreateForm,
    status,
    statusError,
    upstream,
    width,
  } = useGithubPanelController({
    baseBranch,
    diff,
    githubConnected,
    open,
    sandboxId,
  })

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
              upstream={upstream}
            />

            {actionError ? <ErrorBanner message={actionError} /> : null}

            <ChangesSection
              files={files}
              diffStatByPath={diffStatByPath}
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

            <PullRequestSection
              connected={connected}
              prs={prs}
              repoUrl={repoUrl}
              busy={busy}
              showCreateForm={showCreateForm}
              compareUrl={compareUrl}
              prTitle={prTitle}
              prBody={prBody}
              prDraft={prDraft}
              baseBranch={baseBranch}
              branch={branch}
              onOpenCreateForm={openCreateForm}
              onCancelCreateForm={onCancelCreateForm}
              onChangeTitle={onChangeTitle}
              onChangeBody={onChangeBody}
              onChangeDraft={onChangeDraft}
              onCreate={createPr}
            />
          </div>
        )}
      </div>
    </aside>
  )
}
