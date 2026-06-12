"use client"

import { Plus } from "lucide-react"

import { repoLabel } from "@/components/chat/format"
import { PullRequestCard } from "@/components/github/panel-pr-card"
import { CreatePrForm } from "@/components/github/panel-pr-form"
import {
  SecondaryButton,
  SectionHeading,
} from "@/components/github/panel-shared"
import type {
  GithubPanelBusyKind,
  GithubPrEntry,
} from "@/components/github/panel-types"
import { cardSurfaceClass } from "@/components/ui/surface"
import { cn } from "@/lib/shared/utils"

export function PullRequestSection({
  baseBranch,
  branch,
  busy,
  compareUrl,
  connected,
  onCancelCreateForm,
  onChangeBody,
  onChangeDraft,
  onChangeTitle,
  onCreate,
  onOpenCreateForm,
  prBody,
  prDraft,
  prTitle,
  prs,
  repoUrl,
  showCreateForm,
}: {
  baseBranch: string
  branch: string | null
  busy: GithubPanelBusyKind
  compareUrl: string | null
  connected: boolean
  onCancelCreateForm: () => void
  onChangeBody: (value: string) => void
  onChangeDraft: (value: boolean) => void
  onChangeTitle: (value: string) => void
  onCreate: () => void
  onOpenCreateForm: () => void
  prBody: string
  prDraft: boolean
  prTitle: string
  prs: GithubPrEntry[]
  repoUrl: string
  showCreateForm: boolean
}) {
  const hasOpen = prs.some((pr) => pr.state === "open" && !pr.merged)

  return (
    <div className="mt-4">
      <SectionHeading count={prs.length > 1 ? prs.length : undefined}>
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
            <PullRequestCard key={pr.number} pr={pr} checks={pr.checks} />
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
