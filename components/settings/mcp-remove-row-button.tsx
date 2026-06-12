"use client"

import { Trash2 } from "lucide-react"

import { IconButton } from "@/components/ui/icon-button"
import { cn } from "@/lib/shared/utils"

export function McpRemoveRowButton({
  hidden,
  label,
  onRemove,
}: {
  hidden: boolean
  label: string
  onRemove: () => void
}) {
  return (
    <IconButton
      type="button"
      onClick={onRemove}
      disabled={hidden}
      tabIndex={hidden ? -1 : undefined}
      aria-hidden={hidden}
      aria-label={label}
      className={cn(
        "hover:bg-destructive/10 hover:text-destructive",
        hidden && "pointer-events-none invisible"
      )}
    >
      <Trash2 className="size-3.5" />
    </IconButton>
  )
}
