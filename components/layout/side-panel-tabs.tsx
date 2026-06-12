"use client"

import { cn } from "@/lib/shared/utils"

export function SidePanelTabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
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
      ) : null}
    </button>
  )
}
