"use client"

import {
  CircleDot,
  Loader2,
  OctagonX,
  Plus,
  RefreshCw,
  SquareTerminal,
  X,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useCallback, useEffect, useReducer, useRef, useState } from "react"

import { ContextMenu } from "@/components/ui/context-menu"
import { IconButton } from "@/components/ui/icon-button"
import { SandboxTerminalPane } from "@/components/sandbox/terminal-pane"
import { killBrowserTerminalSession } from "@/components/sandbox/terminal-session"
import { SandboxTerminalTab } from "@/components/sandbox/terminal-tab"
import {
  createTerminalId,
  darkPalette,
  lightPalette,
  loadPersistedTerminalDock,
  type MountedTerminalState,
  persistTerminalDock,
  terminalDockReducer,
  terminalNumbersFromDock,
  terminalStatusLabel,
  type TerminalSessionState,
} from "@/components/sandbox/terminal-model"
import { useTerminalPanelResize } from "@/hooks/use-terminal-panel-resize"
import { cn } from "@/lib/shared/utils"

export function SandboxTerminalPanel({
  open,
  sandboxId,
  onClose,
  height,
  onHeightChange,
}: {
  open: boolean
  sandboxId: string | null
  onClose: () => void
  height: number
  onHeightChange: (height: number) => void
}) {
  const [dock, dispatchDock] = useReducer(
    terminalDockReducer,
    undefined,
    loadPersistedTerminalDock
  )
  const [sessionStates, setSessionStates] = useState<
    Record<string, TerminalSessionState>
  >({})
  const mountedBySandboxRef = useRef<MountedTerminalState>({})
  const [renaming, setRenaming] = useState<{
    draft: string
    terminalId: string
  } | null>(null)
  const [menu, setMenu] = useState<{
    terminalId: string
    x: number
    y: number
  } | null>(null)
  const nextTerminalNumberRef = useRef<Record<string, number> | null>(null)
  if (nextTerminalNumberRef.current === null) {
    nextTerminalNumberRef.current = terminalNumbersFromDock(dock)
  }

  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== "light"
  const palette = isDark ? darkPalette : lightPalette
  const lastConnectedSandboxIdRef = useRef<string | null>(null)
  if (open && sandboxId) lastConnectedSandboxIdRef.current = sandboxId
  else if (!sandboxId) lastConnectedSandboxIdRef.current = null
  const connectedSandboxId =
    sandboxId && (open || lastConnectedSandboxIdRef.current === sandboxId)
      ? sandboxId
      : null

  const createTerminalWindow = useCallback((targetSandboxId: string) => {
    const nextTerminalNumber = nextTerminalNumberRef.current!
    const nextNumber = (nextTerminalNumber[targetSandboxId] ?? 0) + 1
    nextTerminalNumber[targetSandboxId] = nextNumber

    return {
      id: createTerminalId(),
      label: `Terminal ${nextNumber}`,
      restartKey: 0,
    }
  }, [])

  useEffect(() => {
    persistTerminalDock(dock)
  }, [dock])

  useEffect(() => {
    if (!connectedSandboxId) return

    dispatchDock({
      type: "connect-sandbox",
      createTerminal: createTerminalWindow,
      sandboxId: connectedSandboxId,
    })
  }, [connectedSandboxId, createTerminalWindow])

  const handleSessionStatusChange = useCallback(
    (terminalId: string, nextState: TerminalSessionState) => {
      setSessionStates((current) => {
        const currentState = current[terminalId]
        if (
          currentState?.status === nextState.status &&
          currentState.error === nextState.error
        ) {
          return current
        }
        return { ...current, [terminalId]: nextState }
      })
    },
    []
  )

  const sessions = connectedSandboxId
    ? (dock.sessionsBySandbox[connectedSandboxId] ?? [])
    : []
  const activeSessionId = connectedSandboxId
    ? dock.activeBySandbox[connectedSandboxId]
    : undefined
  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ??
    sessions[0] ??
    null
  const activeState = activeSession
    ? sessionStates[activeSession.id]
    : undefined
  if (connectedSandboxId && activeSession) {
    const currentMounted = mountedBySandboxRef.current[connectedSandboxId]
    if (!currentMounted?.[activeSession.id]) {
      mountedBySandboxRef.current = {
        ...mountedBySandboxRef.current,
        [connectedSandboxId]: {
          ...currentMounted,
          [activeSession.id]: true,
        },
      }
    }
  }
  const mountedSessions = connectedSandboxId
    ? (mountedBySandboxRef.current[connectedSandboxId] ?? {})
    : {}
  const renderSessions = sessions.filter(
    (session) => mountedSessions[session.id] || session.id === activeSession?.id
  )

  function addTerminalWindow() {
    if (!connectedSandboxId) return
    const terminal = createTerminalWindow(connectedSandboxId)
    dispatchDock({ type: "add", sandboxId: connectedSandboxId, terminal })
  }

  function selectTerminalWindow(terminalId: string) {
    if (!connectedSandboxId) return
    dispatchDock({ type: "select", sandboxId: connectedSandboxId, terminalId })
  }

  function renameTerminalWindow(terminalId: string, nextLabel: string) {
    if (!connectedSandboxId) return
    const trimmed = nextLabel.trim()
    if (!trimmed) return
    dispatchDock({
      type: "rename",
      label: trimmed,
      sandboxId: connectedSandboxId,
      terminalId,
    })
  }

  function closeTerminalWindow(terminalId: string) {
    if (!connectedSandboxId) return
    const sandboxId = connectedSandboxId
    void (async () => {
      try {
        await killBrowserTerminalSession(sandboxId, terminalId, {
          ignoreErrors: false,
        })
        setSessionStates((current) => {
          const next = { ...current }
          delete next[terminalId]
          return next
        })
        const currentMountedSessions = mountedBySandboxRef.current[sandboxId]
        if (currentMountedSessions?.[terminalId]) {
          const { [terminalId]: _removed, ...nextSessions } =
            currentMountedSessions
          void _removed
          mountedBySandboxRef.current = {
            ...mountedBySandboxRef.current,
            [sandboxId]: nextSessions,
          }
        }
        dispatchDock({ type: "close", sandboxId, terminalId })
      } catch (error) {
        setSessionStates((current) => ({
          ...current,
          [terminalId]: {
            error:
              error instanceof Error
                ? error.message
                : "Unable to delete terminal.",
            status: "error",
          },
        }))
      }
    })()
  }

  function reconnectActiveTerminal() {
    if (!connectedSandboxId || !activeSession) return
    const sandboxId = connectedSandboxId
    const terminalId = activeSession.id
    setSessionStates((current) => ({
      ...current,
      [terminalId]: { error: null, status: "connecting" },
    }))
    void (async () => {
      try {
        await killBrowserTerminalSession(sandboxId, terminalId, {
          forget: false,
          ignoreErrors: false,
        })
        dispatchDock({ type: "restart", sandboxId, terminalId })
      } catch (error) {
        setSessionStates((current) => ({
          ...current,
          [terminalId]: {
            error:
              error instanceof Error
                ? error.message
                : "Unable to reconnect terminal.",
            status: "error",
          },
        }))
      }
    })()
  }

  const handleResizeStart = useTerminalPanelResize({
    height,
    onHeightChange,
  })

  if (!open && !connectedSandboxId) return null

  const waitingForSandbox = open && !connectedSandboxId
  const waitingForTerminal = Boolean(connectedSandboxId && !activeSession)
  const statusLabel = waitingForSandbox
    ? "Waiting"
    : waitingForTerminal
      ? "No terminal"
      : terminalStatusLabel(activeState)
  const statusIsError = !waitingForSandbox && activeState?.status === "error"
  const statusIsReady = !waitingForSandbox && activeState?.status === "ready"

  return (
    <section
      aria-hidden={!open}
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[85dvh] min-h-0 flex-col overflow-hidden border-t border-border/60 bg-background text-foreground"
      style={{
        height: open ? height : 0,
        visibility: open ? "visible" : "hidden",
        pointerEvents: open ? undefined : "none",
      }}
    >
      <button
        type="button"
        aria-label="Resize terminal"
        onMouseDown={handleResizeStart}
        className="group absolute top-0 right-0 left-0 z-30 h-2 -translate-y-1 cursor-row-resize border-0 bg-transparent p-0"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 right-0 left-0 h-px bg-border/60 transition-colors group-hover:bg-primary/40"
        />
      </button>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {sessions.map((session) => (
            <SandboxTerminalTab
              key={session.id}
              session={session}
              active={session.id === activeSession?.id}
              editing={renaming?.terminalId === session.id}
              renameDraft={
                renaming?.terminalId === session.id ? renaming.draft : ""
              }
              onSelect={() => selectTerminalWindow(session.id)}
              onStartRename={() => {
                setMenu(null)
                setRenaming({ draft: session.label, terminalId: session.id })
              }}
              onRenameDraftChange={(draft) =>
                setRenaming((current) =>
                  current?.terminalId === session.id
                    ? { ...current, draft }
                    : current
                )
              }
              onCancelRename={() => setRenaming(null)}
              onCommitRename={(label) => {
                renameTerminalWindow(session.id, label)
                setRenaming(null)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setMenu({
                  terminalId: session.id,
                  x: event.clientX,
                  y: event.clientY,
                })
              }}
            />
          ))}
          <IconButton
            onClick={addTerminalWindow}
            disabled={!connectedSandboxId}
            aria-label="New terminal"
            title="New terminal"
            className="ml-0.5"
          >
            <Plus className="size-3.5" />
          </IconButton>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            aria-live="polite"
            className={cn(
              "pointer-events-none inline-flex max-w-48 items-center gap-1.5 truncate px-1.5 text-xs font-medium",
              statusIsError ? "text-destructive" : "text-muted-foreground"
            )}
            title={
              statusIsError ? (activeState?.error ?? undefined) : undefined
            }
          >
            {statusIsReady ? (
              <CircleDot className="size-3.5 shrink-0 text-success" />
            ) : statusIsError ? (
              <OctagonX className="size-3.5 shrink-0" />
            ) : waitingForTerminal ? (
              <SquareTerminal className="size-3.5 shrink-0" />
            ) : (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            )}
            <span className="truncate">{statusLabel}</span>
          </span>
          <IconButton
            onClick={reconnectActiveTerminal}
            disabled={!activeSession}
            aria-label="Reconnect terminal"
            title="Reconnect terminal"
          >
            <RefreshCw className="size-3.5" />
          </IconButton>
          <IconButton
            onClick={onClose}
            aria-label="Hide terminal dock"
            title="Hide terminal dock"
          >
            <X />
          </IconButton>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-hidden px-3 pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
        style={{ background: palette.background, color: palette.foreground }}
      >
        <div className="relative h-full w-full overflow-hidden">
          {connectedSandboxId && sessions.length > 0 ? (
            renderSessions.map((session) => (
              <SandboxTerminalPane
                key={`${connectedSandboxId}:${session.id}:${session.restartKey}`}
                active={open && session.id === activeSession?.id}
                enabled={open}
                palette={palette}
                sandboxId={connectedSandboxId}
                session={session}
                onStatusChange={handleSessionStatusChange}
              />
            ))
          ) : connectedSandboxId ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <span>No terminal open</span>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>Waiting for sandbox</span>
            </div>
          )}
        </div>
      </div>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Rename",
              onSelect: () => {
                const session = sessions.find(
                  (candidate) => candidate.id === menu.terminalId
                )
                if (session) {
                  setRenaming({ draft: session.label, terminalId: session.id })
                }
              },
            },
            {
              label: "Delete",
              destructive: true,
              onSelect: () => closeTerminalWindow(menu.terminalId),
            },
          ]}
        />
      ) : null}
    </section>
  )
}
