"use client"

import { Loader2, X } from "lucide-react"
import { type CSSProperties, type ReactNode } from "react"

import { ResizeHandle } from "@/components/layout/resize-handle"
import { IconButton } from "@/components/ui/icon-button"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { cn } from "@/lib/shared/utils"

type ResizableSidePanelProps = {
  busy?: boolean
  children: ReactNode
  className?: string
  closeLabel: string
  dataAttributes?: Record<string, true | string>
  defaultWidth: number
  headerActions?: ReactNode
  maxWidth: number
  minWidth: number
  onClose: () => void
  open: boolean
  resizeLabel: string
  storageKey: string
  title: string
}

export function ResizableSidePanel({
  busy = false,
  children,
  className,
  closeLabel,
  dataAttributes,
  defaultWidth,
  headerActions,
  maxWidth,
  minWidth,
  onClose,
  open,
  resizeLabel,
  storageKey,
  title,
}: ResizableSidePanelProps) {
  const isMobile = useIsMobile()
  const { width, resizing, onResizeStart, resetWidth } = useResizablePanel({
    storageKey,
    defaultWidth,
    minWidth,
    maxWidth,
    edge: "left",
    enabled: !isMobile,
  })

  if (!open) return null

  return (
    <aside
      className={cn(
        "fixed inset-0 z-40 flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border/60 bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:relative md:inset-auto md:z-auto md:w-[var(--panel-width)] md:shrink-0 md:pt-0 md:pb-0",
        className
      )}
      style={{ "--panel-width": `${width}px` } as CSSProperties}
      {...dataAttributes}
    >
      <ResizeHandle
        edge="left"
        resizing={resizing}
        onResizeStart={onResizeStart}
        onReset={resetWidth}
        ariaLabel={resizeLabel}
      />
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span className="text-sm font-medium text-foreground/85">{title}</span>
        {busy ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {headerActions}
          <IconButton
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <X className="size-4" />
          </IconButton>
        </div>
      </header>
      {children}
    </aside>
  )
}
