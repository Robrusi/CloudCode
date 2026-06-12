"use client"

import type { ReactNode } from "react"

import { BranchChip } from "@/components/chat/branch-chip"
import { BranchTargetChip } from "@/components/chat/branch-target-chip"
import { PresetPill } from "@/components/chat/controls"
import { RepoChip } from "@/components/chat/repo-chip"
import type { Id } from "@/convex/_generated/dataModel"
import type { BranchMode } from "@/lib/chat/options"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"
import { cn } from "@/lib/shared/utils"

export function NewChatComposerSettings({
  baseBranch,
  branchTargetOpen,
  draftBranchMode,
  draftBranchName,
  editingRepo,
  presetOpen,
  repoUrl,
  sandboxPresetId,
  sandboxPresets,
  onBaseBranchChange,
  onBranchModeChange,
  onBranchNameChange,
  onRepoChange,
  onSandboxPresetSelect,
  setBranchTargetOpen,
  setEditingRepo,
  setPresetOpen,
}: {
  baseBranch: string
  branchTargetOpen: boolean
  draftBranchMode: BranchMode
  draftBranchName: string
  editingRepo: boolean
  presetOpen: boolean
  repoUrl: string
  sandboxPresetId: Id<"sandboxPresets"> | ""
  sandboxPresets: SandboxPresetRecord[]
  onBaseBranchChange: (value: string) => void
  onBranchModeChange: (value: BranchMode) => void
  onBranchNameChange: (value: string) => void
  onRepoChange: (value: string) => void
  onSandboxPresetSelect: (value: Id<"sandboxPresets"> | "") => void
  setBranchTargetOpen: (value: boolean) => void
  setEditingRepo: (value: boolean) => void
  setPresetOpen: (value: boolean) => void
}) {
  return (
    <div className="-mt-3 flex flex-col items-stretch gap-1 rounded-b-3xl border border-t-0 border-field/60 bg-muted/40 px-2.5 pt-5 pb-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1 sm:gap-y-0.5 sm:px-3 sm:pb-2">
      <ComposerSettingRow label="Repository">
        <RepoChip
          value={repoUrl}
          editing={editingRepo}
          setEditing={setEditingRepo}
          onChange={onRepoChange}
          locked={false}
        />
      </ComposerSettingRow>
      <span aria-hidden className="hidden h-3.5 w-px bg-border/70 sm:block" />
      <ComposerSettingRow label="Base branch">
        <BranchChip
          value={baseBranch}
          repoUrl={repoUrl}
          onChange={onBaseBranchChange}
          locked={false}
        />
      </ComposerSettingRow>
      <ComposerSettingRow label="Branch target">
        <BranchTargetChip
          mode={draftBranchMode}
          branchName={draftBranchName}
          baseBranch={baseBranch}
          open={branchTargetOpen}
          setOpen={setBranchTargetOpen}
          onChangeMode={onBranchModeChange}
          onChangeBranchName={onBranchNameChange}
        />
      </ComposerSettingRow>
      <ComposerSettingRow label="Preset" className="sm:ml-auto">
        <PresetPill
          value={sandboxPresetId}
          presets={sandboxPresets}
          open={presetOpen}
          setOpen={setPresetOpen}
          onSelect={onSandboxPresetSelect}
          locked={false}
        />
      </ComposerSettingRow>
    </div>
  )
}

function ComposerSettingRow({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 sm:w-auto sm:justify-start sm:gap-0",
        className
      )}
    >
      <span className="pl-1.5 text-xs text-muted-foreground sm:hidden">
        {label}
      </span>
      {children}
    </div>
  )
}
