"use client"

import { ChevronDown, Loader2 } from "lucide-react"
import { createPortal } from "react-dom"

import type {
  SandboxAction,
  SandboxState,
} from "@/components/chat/sandbox-types"
import {
  formatSandboxAutoStop,
  SANDBOX_STATE_LABEL,
  type SandboxInfo,
  useSandboxInfo,
} from "@/components/sandbox/status"
import { MenuItem } from "@/components/ui/menu"
import { menuPanelClass } from "@/components/ui/menu-styles"
import { useAnchoredRightMenu } from "@/hooks/use-anchored-right-menu"
import { cn } from "@/lib/shared/utils"

type DisplayState =
  | SandboxInfo["state"]
  | "checking"
  | "idle"
  | "missing"
  | "starting"

function sandboxDisplayLabel(state: DisplayState) {
  if (state === "starting") return "Running"
  if (state === "checking") return "Checking"
  if (state === "idle") return "Idle"
  if (state === "missing") return "Missing"
  return SANDBOX_STATE_LABEL[state]
}

export function SandboxMenu({
  sandboxId,
  sandboxPending,
  sandboxState,
  sandboxAction,
  onSandboxStateChange,
  onSandboxMissing,
  onPauseSandbox,
  onResumeSandbox,
  onDeleteSandbox,
}: {
  sandboxId: string | null
  sandboxPending: boolean
  sandboxState?: SandboxState
  sandboxAction: SandboxAction | null
  onSandboxStateChange: (state: SandboxState, sandboxId: string) => void
  onSandboxMissing: (sandboxId: string) => void
  onPauseSandbox: () => void
  onResumeSandbox: () => void
  onDeleteSandbox: () => void
}) {
  const { info, loading, missing, refresh } = useSandboxInfo({
    onMissing: onSandboxMissing,
    onStateChange: onSandboxStateChange,
    sandboxId,
  })
  const { closeMenu, menuPos, open, toggleMenu, triggerRef } =
    useAnchoredRightMenu()
  const busy = sandboxAction !== null || loading

  let display: DisplayState
  if (sandboxPending && missing) {
    display = "starting"
  } else if (missing) {
    display = "deleted"
  } else if (sandboxPending && sandboxId && !info) {
    display = "running"
  } else if (sandboxPending && !sandboxId) {
    display = "starting"
  } else if (info) {
    display = info.state
  } else if (sandboxState) {
    display = sandboxState
  } else if (loading) {
    display = "checking"
  } else if (!sandboxId && !sandboxPending) {
    display = "idle"
  } else {
    display = "checking"
  }

  const stopped = display === "stopped"
  const canAct =
    Boolean(sandboxId) && display !== "deleted" && display !== "idle"

  const showSpinner = busy || display === "starting" || display === "checking"
  const title =
    [
      sandboxId ? `Daytona sandbox ${sandboxId}` : "",
      info?.rawState ? `State ${info.rawState}` : "",
      info?.lastActivityAt
        ? `Last active ${new Date(info.lastActivityAt).toLocaleString()}`
        : "",
      info ? formatSandboxAutoStop(info.autoStopInterval) : "",
    ]
      .filter(Boolean)
      .join("\n") || "Sandbox"

  function handle(action: () => void) {
    closeMenu()
    action()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleMenu}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!canAct}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors hover:bg-muted disabled:opacity-60",
          open && "bg-muted"
        )}
      >
        <span className="font-medium text-foreground/85">Sandbox</span>
        <span aria-hidden className="text-muted-foreground/40">
          ·
        </span>
        <span className="text-muted-foreground">
          {sandboxDisplayLabel(display)}
        </span>
        {showSpinner ? (
          <Loader2 className="ml-0.5 size-3 animate-spin text-muted-foreground" />
        ) : canAct ? (
          <ChevronDown className="ml-0.5 size-3 text-muted-foreground/70" />
        ) : null}
      </button>
      {open && canAct && menuPos && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Close sandbox menu"
                className="fixed inset-0 z-[60] cursor-default border-0 bg-transparent p-0"
                onClick={closeMenu}
                onContextMenu={(event) => {
                  event.preventDefault()
                  closeMenu()
                }}
              />
              <div
                role="menu"
                tabIndex={-1}
                style={{ top: menuPos.top, right: menuPos.right }}
                className={cn("fixed z-[61] min-w-44", menuPanelClass)}
              >
                <MenuItem
                  role="menuitem"
                  disabled={busy}
                  onClick={() =>
                    handle(() => {
                      void refresh()
                    })
                  }
                >
                  Check sandbox state
                </MenuItem>
                <MenuItem
                  role="menuitem"
                  disabled={busy}
                  onClick={() =>
                    handle(stopped ? onResumeSandbox : onPauseSandbox)
                  }
                >
                  {stopped ? "Resume sandbox" : "Pause sandbox"}
                </MenuItem>
                <MenuItem
                  role="menuitem"
                  destructive
                  disabled={busy}
                  onClick={() => handle(onDeleteSandbox)}
                >
                  Delete sandbox
                </MenuItem>
              </div>
            </>,
            document.body
          )
        : null}
    </>
  )
}
