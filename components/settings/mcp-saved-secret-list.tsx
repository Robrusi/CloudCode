"use client"

import { Trash2 } from "lucide-react"

import type { McpVisibleSecret } from "@/components/settings/mcp-model"
import type { McpSecretRemover } from "@/components/settings/mcp-form-types"
import { iconBtn } from "@/components/settings/shared"
import { cn } from "@/lib/shared/utils"

export function McpSavedSecretList({
  label,
  secrets,
  onRemove,
}: {
  label: string
  secrets: McpVisibleSecret[]
  onRemove: McpSecretRemover
}) {
  if (!secrets.length) return null
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-foreground/80">{label}</div>
      <div className="overflow-hidden rounded-lg border border-border/60">
        {secrets.map((secret) => (
          <div
            key={secret.id}
            className="flex items-center gap-2 border-b border-border/60 px-3 py-2 last:border-0"
          >
            <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-xs text-foreground/85">
              {secret.name}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              Saved
            </span>
            <button
              type="button"
              onClick={() => onRemove(secret.id)}
              aria-label={`Remove ${secret.name}`}
              className={cn(iconBtn, "hover:text-destructive")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
