"use client"

import { SquareTerminal } from "lucide-react"
import { type MouseEvent as ReactMouseEvent, useCallback } from "react"

import type { TerminalWindow } from "@/components/sandbox/terminal-model"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/shared/utils"

export function SandboxTerminalTab({
  active,
  editing,
  renameDraft,
  session,
  onSelect,
  onStartRename,
  onRenameDraftChange,
  onCancelRename,
  onCommitRename,
  onContextMenu,
}: {
  active: boolean
  editing: boolean
  renameDraft: string
  session: TerminalWindow
  onSelect: () => void
  onStartRename: () => void
  onRenameDraftChange: (draft: string) => void
  onCancelRename: () => void
  onCommitRename: (label: string) => void
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
}) {
  const setRenameInputRef = useCallback((node: HTMLInputElement | null) => {
    node?.focus()
    node?.select()
  }, [])

  const containerClass = cn(
    "flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors",
    active
      ? "bg-muted text-foreground"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
  )

  if (editing) {
    return (
      <div onContextMenu={onContextMenu} className={containerClass}>
        <SquareTerminal className="size-3.5 shrink-0" />
        <Input
          ref={setRenameInputRef}
          variant="bare"
          aria-label={`Rename ${session.label}`}
          value={renameDraft}
          onChange={(event) => onRenameDraftChange(event.target.value)}
          onBlur={(event) => onCommitRename(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onCommitRename(event.currentTarget.value)
            } else if (event.key === "Escape") {
              event.preventDefault()
              onCancelRename()
            }
          }}
          className="w-28 text-xs text-foreground"
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onStartRename}
      onContextMenu={onContextMenu}
      aria-label={`Open ${session.label}`}
      aria-pressed={active}
      title={session.label}
      className={cn(
        containerClass,
        "outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      )}
    >
      <SquareTerminal className="size-3.5 shrink-0" />
      <span className="max-w-28 truncate">{session.label}</span>
    </button>
  )
}
