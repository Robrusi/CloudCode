"use client"

import { Plus, X } from "lucide-react"

import { usePresetSettingsController } from "@/components/settings/presets-controller"
import { PresetEditorFields } from "@/components/settings/presets-form"
import { PresetList } from "@/components/settings/presets-list"
import { iconBtn, navAction, SettingsPage } from "@/components/settings/shared"
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
        <button
          type="button"
          onClick={controller.startNewPreset}
          className={navAction}
        >
          <Plus className="size-3.5" />
          New preset
        </button>
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
            <button
              type="button"
              onClick={controller.resetEditor}
              aria-label="Close editor"
              className={iconBtn}
            >
              <X className="size-3.5" />
            </button>
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
