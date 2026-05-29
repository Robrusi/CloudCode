"use client"

import type { ResizeEdge } from "@/hooks/use-resizable-panel"
import { cn } from "@/lib/utils"

interface ResizeHandleProps {
  /** Edge of the parent panel the handle is pinned to. */
  edge: ResizeEdge
  /** True while a drag is in progress, used to keep the indicator lit. */
  resizing: boolean
  onResizeStart: (event: React.MouseEvent) => void
  /** Double-click resets the panel to its default width. */
  onReset?: () => void
  ariaLabel: string
}

/**
 * Vertical drag handle for horizontally resizing a panel. Sits flush against
 * the panel's border on the given edge; the parent must be `relative`. The hit
 * area is wider than the visible 1px indicator so the border is easy to grab.
 */
export function ResizeHandle({
  edge,
  resizing,
  onResizeStart,
  onReset,
  ariaLabel,
}: ResizeHandleProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onMouseDown={onResizeStart}
      onDoubleClick={onReset}
      className={cn(
        // Hidden on mobile, where panels are full-screen overlays rather than
        // resizable columns.
        "group absolute inset-y-0 z-30 hidden w-2 cursor-col-resize border-0 bg-transparent p-0 md:block",
        edge === "right" ? "right-0" : "left-0"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 w-px transition-colors",
          edge === "right" ? "right-0" : "left-0",
          resizing
            ? "bg-primary/60"
            : "bg-transparent group-hover:bg-primary/40"
        )}
      />
    </button>
  )
}
