import { menuPanelClass } from "@/components/ui/menu-styles"
import { cn } from "@/lib/shared/utils"

export const chipTrigger =
  "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-expanded:bg-muted aria-expanded:text-foreground"

export const popoverPanel = cn(
  "absolute z-10 max-w-[calc(100vw-1.5rem)] min-w-44",
  menuPanelClass
)

export const popoverHeading =
  "px-2.5 pt-1.5 pb-1 text-left text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase"

export const popoverItem =
  "flex w-full items-center justify-between gap-6 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
