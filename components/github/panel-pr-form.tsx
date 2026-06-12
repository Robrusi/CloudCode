"use client"

import { ExternalLink, GitBranch, GitPullRequest } from "lucide-react"

import {
  PrimaryButton,
  SecondaryButton,
} from "@/components/github/panel-shared"
import type { GithubPanelBusyKind } from "@/components/github/panel-types"
import { MarkdownEditor } from "@/components/markdown/editor"
import { Checkbox as UiCheckbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { cardSurfaceClass } from "@/components/ui/surface"
import { useImageUpload } from "@/hooks/use-image-upload"
import { cn } from "@/lib/shared/utils"

export function CreatePrForm({
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
  busy: GithubPanelBusyKind
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
  const uploadImage = useImageUpload()

  return (
    <div className={cn("overflow-hidden", cardSurfaceClass)}>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">
          New pull request
        </span>
        <span className="ml-auto inline-flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
          <GitBranch className="size-3 shrink-0" />
          <span className="max-w-[6rem] truncate">{head ?? "HEAD"}</span>
          <span className="text-muted-foreground/50">→</span>
          <span className="max-w-[6rem] truncate">{base || "default"}</span>
        </span>
      </div>
      <Input
        variant="bare"
        aria-label="Pull request title"
        value={title}
        onChange={(event) => onChangeTitle(event.target.value)}
        placeholder="Title"
        spellCheck={false}
        className="block border-b border-border/60 px-3 py-2.5 text-[13px] font-medium text-foreground placeholder:font-medium"
      />
      <MarkdownEditor
        value={body}
        onChange={onChangeBody}
        onUploadImage={uploadImage}
        enableImages
        ariaLabel="Pull request description"
        placeholder="Describe your changes — paste an image, or add headings, lists, to-dos…"
        contentClassName="max-h-[40vh] min-h-28"
      />

      {compareUrl ? (
        <a
          href={compareUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2 text-[11px] text-foreground/80 transition-colors hover:bg-muted/40"
        >
          <ExternalLink className="size-3.5 shrink-0" />
          Open on GitHub to finish creating it.
        </a>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-2.5 py-2">
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
