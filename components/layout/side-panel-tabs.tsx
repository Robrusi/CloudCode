"use client"

import { cn } from "@/lib/shared/utils"

export type SidePanelTabDot = "danger" | "muted" | "pending" | "success"

const TAB_DOT_CLASSES: Record<SidePanelTabDot, string> = {
  danger: "bg-destructive",
  muted: "bg-muted-foreground/50",
  pending: "animate-pulse bg-muted-foreground",
  success: "bg-success",
}

export function SidePanelTabButton({
  active,
  label,
  count,
  dot,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  dot?: SidePanelTabDot
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 text-center text-xs font-medium transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      {count ? (
        <span
          className={cn(
            "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]",
            active
              ? "bg-foreground/10 text-foreground"
              : "bg-muted-foreground/15 text-muted-foreground"
          )}
        >
          {count}
        </span>
      ) : dot ? (
        <span
          className={cn("size-1.5 rounded-full", TAB_DOT_CLASSES[dot])}
          aria-hidden
        />
      ) : null}
    </button>
  )
}
