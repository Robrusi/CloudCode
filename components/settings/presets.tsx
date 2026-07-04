"use client"

import { Plus, X } from "lucide-react"

import { usePresetSettingsController } from "@/components/settings/presets-controller"
import { PresetEditorFields } from "@/components/settings/presets-form"
import { PresetList } from "@/components/settings/presets-list"
import { SettingsPage } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"

export function PresetSettings({
  presets,
}: {
  presets: SandboxPresetRecord[]
}) {
  const controller = usePresetSettingsController(presets)

  return (
    <SettingsPage
      title="Presets"
      description="Configure sandbox environments, install scripts, and secrets."
      action={
        <Button
          size="sm"
          onClick={controller.startNewPreset}
          className="gap-1.5"
        >
          <Plus className="size-4" />
          New preset
        </Button>
      }
    >
      {controller.creating ? (
        <div className="rounded-2xl border border-border/60 bg-muted/40 p-4 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                New preset
              </div>
              <div className="text-xs text-muted-foreground">
                Configure a sandbox preset
              </div>
            </div>
            <IconButton
              size="sm"
              onClick={controller.resetEditor}
              aria-label="Close editor"
            >
              <X className="size-3.5" />
            </IconButton>
          </div>
          <PresetEditorFields {...controller} />
        </div>
      ) : null}

      <PresetList
        presets={presets}
        selectedId={controller.selected?.id ?? null}
        onResetEditor={controller.resetEditor}
        onSelectPreset={controller.selectPreset}
        onStartNewPreset={controller.startNewPreset}
      >
        <PresetEditorFields {...controller} />
      </PresetList>
    </SettingsPage>
  )
}
