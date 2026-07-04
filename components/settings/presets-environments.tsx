"use client"

import { Trash2 } from "lucide-react"

import { metaPill } from "@/components/settings/shared"
import { presetRepoLabel } from "@/components/settings/presets-model"
import { IconButton } from "@/components/ui/icon-button"
import type { Id } from "@/convex/_generated/dataModel"
import type { SandboxPresetEnvironmentRecord } from "@/lib/sandbox/preset-types"

export function PresetEnvironmentList({
  environments,
  saving,
  onDelete,
}: {
  environments: SandboxPresetEnvironmentRecord[] | undefined
  saving: boolean
  onDelete: (environmentId: Id<"sandboxPresetEnvironments">) => void
}) {
  if (!environments?.length) return null

  return (
    <div className="border-y border-border/60">
      {environments.map((environment) => (
        <div
          key={environment.id}
          className="flex items-center gap-2 border-b border-border/60 py-2 last:border-0"
        >
          <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
            {presetRepoLabel(environment.repoUrl)}
          </span>
          <span className={metaPill}>{environment.status}</span>
          <IconButton
            size="sm"
            onClick={() => onDelete(environment.id)}
            disabled={saving}
            aria-label={`Delete cloudcode.yaml for ${environment.repoUrl}`}
            title="Delete saved cloudcode.yaml"
            className="hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      ))}
    </div>
  )
}
