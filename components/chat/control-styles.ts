import { menuPanelClass } from "@/components/ui/menu-styles"
import { cn } from "@/lib/shared/utils"

export const chipTrigger =
  "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50"

export const popoverPanel = cn(
  "absolute z-10 max-w-[calc(100vw-1.5rem)] min-w-44",
  menuPanelClass
)

export const popoverItem =
  "flex w-full items-center justify-between gap-6 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
