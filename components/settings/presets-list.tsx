"use client"

import type { ReactNode } from "react"
import { ChevronRight, Layers3, Plus } from "lucide-react"

import { sandboxPresetSubtitle } from "@/components/settings/presets-model"
import { navAction } from "@/components/settings/shared"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"
import { cn } from "@/lib/shared/utils"

export function PresetList({
  children,
  presets,
  selectedId,
  onResetEditor,
  onSelectPreset,
  onStartNewPreset,
}: {
  children: ReactNode
  presets: SandboxPresetRecord[]
  selectedId: string | null
  onResetEditor: () => void
  onSelectPreset: (preset: SandboxPresetRecord) => void
  onStartNewPreset: () => void
}) {
  if (presets.length === 0) {
    return <PresetEmptyState onStartNewPreset={onStartNewPreset} />
  }

  return (
    <div className="space-y-2">
      {presets.map((preset) => (
        <PresetListItem
          key={preset.id}
          active={selectedId === preset.id}
          preset={preset}
          onResetEditor={onResetEditor}
          onSelectPreset={onSelectPreset}
        >
          {children}
        </PresetListItem>
      ))}
    </div>
  )
}

function PresetEmptyState({
  onStartNewPreset,
}: {
  onStartNewPreset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <Layers3 className="size-5 text-muted-foreground" />
      <div>
        <div className="text-sm font-medium text-foreground">
          No presets yet
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Create one to set up tools, install scripts, and secrets.
        </p>
      </div>
      <button type="button" onClick={onStartNewPreset} className={navAction}>
        <Plus className="size-3.5" />
        New preset
      </button>
    </div>
  )
}

function PresetListItem({
  active,
  children,
  preset,
  onResetEditor,
  onSelectPreset,
}: {
  active: boolean
  children: ReactNode
  preset: SandboxPresetRecord
  onResetEditor: () => void
  onSelectPreset: (preset: SandboxPresetRecord) => void
}) {
  const subtitle = sandboxPresetSubtitle(preset)

  function togglePreset() {
    if (active) {
      onResetEditor()
    } else {
      onSelectPreset(preset)
    }
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/60 transition-colors",
        active && "bg-muted/40"
      )}
    >
      <button
        type="button"
        onClick={togglePreset}
        aria-expanded={active}
        className={cn(
          "group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
          active ? "" : "hover:bg-muted"
        )}
      >
        <Layers3 className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {preset.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {subtitle}
          </div>
        </div>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            active
              ? "rotate-90 text-muted-foreground"
              : "text-muted-foreground/50 group-hover:text-muted-foreground"
          )}
        />
      </button>
      {active ? (
        <div className="px-3 pb-3">
          <div className="border-t border-border/60 pt-3">{children}</div>
        </div>
      ) : null}
    </div>
  )
}
