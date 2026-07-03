"use client"

import { useSandboxTerminalPaneController } from "@/components/sandbox/terminal-pane-controller"
import {
  type TerminalPalette,
  type TerminalSessionState,
  type TerminalWindow,
} from "@/components/sandbox/terminal-model"
import { cn } from "@/lib/shared/utils"

export function SandboxTerminalPane({
  active,
  enabled,
  palette,
  sandboxId,
  session,
  onStatusChange,
}: {
  active: boolean
  enabled: boolean
  palette: TerminalPalette
  sandboxId: string
  session: TerminalWindow
  onStatusChange: (terminalId: string, state: TerminalSessionState) => void
}) {
  const { containerRef, focusTerminalFromPointer } =
    useSandboxTerminalPaneController({
      active,
      enabled,
      palette,
      sandboxId,
      session,
      onStatusChange,
    })

  return (
    <div
      aria-hidden={!active}
      className={cn(
        "absolute inset-0 flex flex-col overflow-hidden transition-opacity",
        active ? "opacity-100" : "pointer-events-none opacity-0"
      )}
      style={{ background: palette.background }}
    >
      <div className="relative min-h-0 w-full flex-1 overflow-hidden">
        <div
          ref={containerRef}
          onPointerDown={focusTerminalFromPointer}
          className="h-full w-full overflow-hidden [&_.xterm]:!bg-transparent [&_.xterm-screen]:outline-none [&_.xterm-viewport]:!bg-transparent"
          style={{ background: palette.background }}
        />
      </div>
    </div>
  )
}
