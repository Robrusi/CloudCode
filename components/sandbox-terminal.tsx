"use client"

import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
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
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import { ContextMenu } from "@/components/context-menu"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import {
  killBrowserTerminalSession,
  registerTerminalCloser,
  WARM_BROWSER_TERMINAL_EVENT,
} from "@/components/sandbox-terminal-session"
import { cn } from "@/lib/utils"

type TerminalStatus = "connecting" | "ready" | "reconnecting" | "error"

type TerminalPalette = {
  background: string
  black: string
  blue: string
  brightBlack: string
  brightBlue: string
  brightCyan: string
  brightGreen: string
  brightMagenta: string
  brightRed: string
  brightWhite: string
  brightYellow: string
  cursor: string
  cursorAccent: string
  cyan: string
  foreground: string
  green: string
  magenta: string
  red: string
  selectionBackground: string
  selectionForeground: string
  white: string
  yellow: string
}

type TerminalWindow = {
  id: string
  label: string
  restartKey: number
}

type TerminalDockState = {
  activeBySandbox: Record<string, string>
  sessionsBySandbox: Record<string, TerminalWindow[]>
}

type MountedTerminalState = Record<string, Record<string, true>>

type TerminalSessionState = {
  error: string | null
  status: TerminalStatus
}

const TERMINAL_DOCK_KEY = "cloudcode:terminalDock:v1"
const TERMINAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/
const TERMINAL_INPUT_FLUSH_DELAY_MS = 10

const darkPalette: TerminalPalette = {
  background: "#0b0d10",
  black: "#15181d",
  blue: "#7aa2f7",
  brightBlack: "#5b6172",
  brightBlue: "#9ab8ff",
  brightCyan: "#7dd3fc",
  brightGreen: "#9ee6a3",
  brightMagenta: "#d8b4fe",
  brightRed: "#ffa39e",
  brightWhite: "#ffffff",
  brightYellow: "#fbd38d",
  cursor: "#e6e8eb",
  cursorAccent: "#0b0d10",
  cyan: "#67e8f9",
  foreground: "#e6e8eb",
  green: "#73d13d",
  magenta: "#c084fc",
  red: "#ff7373",
  selectionBackground: "rgba(122, 162, 247, 0.28)",
  selectionForeground: "#ffffff",
  white: "#d7d7d7",
  yellow: "#f4bf75",
}

const lightPalette: TerminalPalette = {
  background: "#fbfbfa",
  black: "#1f2328",
  blue: "#0969da",
  brightBlack: "#6e7781",
  brightBlue: "#218bff",
  brightCyan: "#179299",
  brightGreen: "#1a7f37",
  brightMagenta: "#a475f9",
  brightRed: "#cf222e",
  brightWhite: "#1f2328",
  brightYellow: "#9a6700",
  cursor: "#1f2328",
  cursorAccent: "#fbfbfa",
  cyan: "#0e7490",
  foreground: "#1f2328",
  green: "#1f883d",
  magenta: "#8250df",
  red: "#d1242f",
  selectionBackground: "rgba(9, 105, 218, 0.18)",
  selectionForeground: "#1f2328",
  white: "#57606a",
  yellow: "#bf8700",
}

function createTerminalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `cloudcode-${crypto.randomUUID()}`
  }
  return `cloudcode-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`
}

function terminalStatusLabel(state: TerminalSessionState | undefined) {
  if (!state) return "Starting"
  if (state.status === "ready") return "Connected"
  if (state.status === "reconnecting") return "Reconnecting"
  if (state.status === "error") return state.error ?? "Connection issue"
  return "Connecting"
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function loadPersistedTerminalDock(): TerminalDockState {
  if (typeof window === "undefined") {
    return { activeBySandbox: {}, sessionsBySandbox: {} }
  }

  try {
    const raw = localStorage.getItem(TERMINAL_DOCK_KEY)
    if (!raw) return { activeBySandbox: {}, sessionsBySandbox: {} }

    const parsed = JSON.parse(raw) as unknown
    if (!isPlainRecord(parsed)) {
      return { activeBySandbox: {}, sessionsBySandbox: {} }
    }

    const persistedSessions = isPlainRecord(parsed.sessionsBySandbox)
      ? parsed.sessionsBySandbox
      : {}
    const persistedActive = isPlainRecord(parsed.activeBySandbox)
      ? parsed.activeBySandbox
      : {}
    const sessionsBySandbox: Record<string, TerminalWindow[]> = {}
    const activeBySandbox: Record<string, string> = {}

    for (const [sandboxId, value] of Object.entries(persistedSessions)) {
      if (!sandboxId || !Array.isArray(value)) continue
      const seen = new Set<string>()
      const sessions: TerminalWindow[] = []

      for (const item of value) {
        if (!isPlainRecord(item)) continue
        const id = typeof item.id === "string" ? item.id : ""
        if (!TERMINAL_ID_PATTERN.test(id) || seen.has(id)) continue

        seen.add(id)
        sessions.push({
          id,
          label:
            typeof item.label === "string" && item.label.trim()
              ? item.label.trim()
              : `Terminal ${sessions.length + 1}`,
          restartKey: 0,
        })
      }

      if (sessions.length === 0) continue
      sessionsBySandbox[sandboxId] = sessions

      const activeId = persistedActive[sandboxId]
      activeBySandbox[sandboxId] =
        typeof activeId === "string" &&
        sessions.some((session) => session.id === activeId)
          ? activeId
          : sessions[0].id
    }

    return { activeBySandbox, sessionsBySandbox }
  } catch {
    return { activeBySandbox: {}, sessionsBySandbox: {} }
  }
}

function persistTerminalDock(dock: TerminalDockState) {
  if (typeof window === "undefined") return

  try {
    const sessionsBySandbox = Object.fromEntries(
      Object.entries(dock.sessionsBySandbox)
        .map(([sandboxId, sessions]) => [
          sandboxId,
          sessions.map(({ id, label }) => ({ id, label })),
        ])
        .filter(([, sessions]) => sessions.length > 0)
    )

    if (Object.keys(sessionsBySandbox).length === 0) {
      localStorage.removeItem(TERMINAL_DOCK_KEY)
      return
    }

    localStorage.setItem(
      TERMINAL_DOCK_KEY,
      JSON.stringify({
        activeBySandbox: dock.activeBySandbox,
        sessionsBySandbox,
      })
    )
  } catch {
    // Losing persisted dock metadata should not interrupt live terminal input.
  }
}

function terminalNumbersFromDock(dock: TerminalDockState) {
  const numbers: Record<string, number> = {}

  for (const [sandboxId, sessions] of Object.entries(dock.sessionsBySandbox)) {
    numbers[sandboxId] = sessions.reduce((max, session, index) => {
      const match = /^Terminal (\d+)$/.exec(session.label)
      const labelNumber = match ? Number(match[1]) : index + 1
      return Number.isFinite(labelNumber) ? Math.max(max, labelNumber) : max
    }, 0)
  }

  return numbers
}

function isEditableElement(element: Element | null) {
  if (!element) return false
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return true
  }

  return (
    element instanceof HTMLElement &&
    (element.isContentEditable || element.getAttribute("role") === "textbox")
  )
}

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
  const [startedSandboxId, setStartedSandboxId] = useState<string | null>(null)
  const [dock, setDock] = useState<TerminalDockState>(loadPersistedTerminalDock)
  const [sessionStates, setSessionStates] = useState<
    Record<string, TerminalSessionState>
  >({})
  const [mountedBySandbox, setMountedBySandbox] =
    useState<MountedTerminalState>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{
    terminalId: string
    x: number
    y: number
  } | null>(null)
  const dragStartRef = useRef<{ h: number; y: number } | null>(null)
  const nextTerminalNumberRef = useRef<Record<string, number>>(
    terminalNumbersFromDock(dock)
  )

  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== "light"
  const palette = isDark ? darkPalette : lightPalette
  const connectedSandboxId =
    startedSandboxId === sandboxId ? startedSandboxId : open ? sandboxId : null

  const createTerminalWindow = useCallback((targetSandboxId: string) => {
    const nextNumber = (nextTerminalNumberRef.current[targetSandboxId] ?? 0) + 1
    nextTerminalNumberRef.current[targetSandboxId] = nextNumber

    return {
      id: createTerminalId(),
      label: `Terminal ${nextNumber}`,
      restartKey: 0,
    }
  }, [])

  useEffect(() => {
    if (!sandboxId) {
      setStartedSandboxId(null)
      return
    }

    if (open && startedSandboxId !== sandboxId) {
      setStartedSandboxId(sandboxId)
    }
  }, [open, sandboxId, startedSandboxId])

  useEffect(() => {
    if (!sandboxId || startedSandboxId === sandboxId) return

    const timeout = window.setTimeout(() => {
      setStartedSandboxId((current) =>
        current === sandboxId ? current : sandboxId
      )
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [sandboxId, startedSandboxId])

  useEffect(() => {
    if (!sandboxId) return

    function handleWarmTerminal(event: Event) {
      const warmSandboxId = (event as CustomEvent<{ sandboxId?: unknown }>)
        .detail?.sandboxId
      if (warmSandboxId !== sandboxId) return

      setStartedSandboxId((current) =>
        current === sandboxId ? current : sandboxId
      )
    }

    window.addEventListener(WARM_BROWSER_TERMINAL_EVENT, handleWarmTerminal)
    return () => {
      window.removeEventListener(
        WARM_BROWSER_TERMINAL_EVENT,
        handleWarmTerminal
      )
    }
  }, [sandboxId])

  useEffect(() => {
    persistTerminalDock(dock)
  }, [dock])

  useEffect(() => {
    if (!connectedSandboxId) return

    setDock((current) => {
      const sessions = current.sessionsBySandbox[connectedSandboxId] ?? []
      if (sessions.length > 0) {
        const activeId = current.activeBySandbox[connectedSandboxId]
        if (activeId && sessions.some((session) => session.id === activeId)) {
          return current
        }

        return {
          activeBySandbox: {
            ...current.activeBySandbox,
            [connectedSandboxId]: sessions[0].id,
          },
          sessionsBySandbox: current.sessionsBySandbox,
        }
      }

      const terminal = createTerminalWindow(connectedSandboxId)
      return {
        activeBySandbox: {
          ...current.activeBySandbox,
          [connectedSandboxId]: terminal.id,
        },
        sessionsBySandbox: {
          ...current.sessionsBySandbox,
          [connectedSandboxId]: [terminal],
        },
      }
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
  const mountedSessions = connectedSandboxId
    ? (mountedBySandbox[connectedSandboxId] ?? {})
    : {}
  const renderSessions = sessions.filter(
    (session) => mountedSessions[session.id] || session.id === activeSession?.id
  )

  useEffect(() => {
    if (!connectedSandboxId || !activeSession) return

    setMountedBySandbox((current) => {
      if (current[connectedSandboxId]?.[activeSession.id]) return current

      return {
        ...current,
        [connectedSandboxId]: {
          ...current[connectedSandboxId],
          [activeSession.id]: true,
        },
      }
    })
  }, [activeSession, connectedSandboxId])

  function addTerminalWindow() {
    if (!connectedSandboxId) return
    const terminal = createTerminalWindow(connectedSandboxId)
    setDock((current) => ({
      activeBySandbox: {
        ...current.activeBySandbox,
        [connectedSandboxId]: terminal.id,
      },
      sessionsBySandbox: {
        ...current.sessionsBySandbox,
        [connectedSandboxId]: [
          ...(current.sessionsBySandbox[connectedSandboxId] ?? []),
          terminal,
        ],
      },
    }))
  }

  function selectTerminalWindow(terminalId: string) {
    if (!connectedSandboxId) return
    setDock((current) => ({
      activeBySandbox: {
        ...current.activeBySandbox,
        [connectedSandboxId]: terminalId,
      },
      sessionsBySandbox: current.sessionsBySandbox,
    }))
  }

  function renameTerminalWindow(terminalId: string, nextLabel: string) {
    if (!connectedSandboxId) return
    const trimmed = nextLabel.trim()
    if (!trimmed) return
    setDock((current) => {
      const currentSessions =
        current.sessionsBySandbox[connectedSandboxId] ?? []
      if (
        !currentSessions.some(
          (session) => session.id === terminalId && session.label !== trimmed
        )
      ) {
        return current
      }
      return {
        activeBySandbox: current.activeBySandbox,
        sessionsBySandbox: {
          ...current.sessionsBySandbox,
          [connectedSandboxId]: currentSessions.map((session) =>
            session.id === terminalId ? { ...session, label: trimmed } : session
          ),
        },
      }
    })
  }

  function closeTerminalWindow(terminalId: string) {
    if (!connectedSandboxId || sessions.length <= 1) return
    void killBrowserTerminalSession(connectedSandboxId, terminalId)
    setSessionStates((current) => {
      const next = { ...current }
      delete next[terminalId]
      return next
    })
    setMountedBySandbox((current) => {
      const currentSessions = current[connectedSandboxId]
      if (!currentSessions?.[terminalId]) return current

      const { [terminalId]: _removed, ...nextSessions } = currentSessions
      void _removed
      return {
        ...current,
        [connectedSandboxId]: nextSessions,
      }
    })
    setDock((current) => {
      const currentSessions =
        current.sessionsBySandbox[connectedSandboxId] ?? []
      const removedIndex = currentSessions.findIndex(
        (session) => session.id === terminalId
      )
      const nextSessions = currentSessions.filter(
        (session) => session.id !== terminalId
      )
      const nextActiveId =
        current.activeBySandbox[connectedSandboxId] === terminalId
          ? (nextSessions[Math.max(0, removedIndex - 1)] ?? nextSessions[0])?.id
          : current.activeBySandbox[connectedSandboxId]

      return {
        activeBySandbox: {
          ...current.activeBySandbox,
          ...(nextActiveId ? { [connectedSandboxId]: nextActiveId } : {}),
        },
        sessionsBySandbox: {
          ...current.sessionsBySandbox,
          [connectedSandboxId]: nextSessions,
        },
      }
    })
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
      await killBrowserTerminalSession(sandboxId, terminalId, {
        forget: false,
      })
      setDock((current) => {
        const currentSessions = current.sessionsBySandbox[sandboxId] ?? []
        return {
          activeBySandbox: current.activeBySandbox,
          sessionsBySandbox: {
            ...current.sessionsBySandbox,
            [sandboxId]: currentSessions.map((session) =>
              session.id === terminalId
                ? { ...session, restartKey: session.restartKey + 1 }
                : session
            ),
          },
        }
      })
    })()
  }

  function handleResizeStart(e: ReactMouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    dragStartRef.current = { h: height, y: e.clientY }

    function onMove(ev: MouseEvent) {
      const ctx = dragStartRef.current
      if (!ctx) return
      const next = Math.min(
        Math.max(260, ctx.h + (ctx.y - ev.clientY)),
        Math.max(300, window.innerHeight - 180)
      )
      onHeightChange(next)
    }

    function onUp() {
      dragStartRef.current = null
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      document.body.style.removeProperty("cursor")
      document.body.style.removeProperty("user-select")
    }

    document.body.style.cursor = "row-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  if (!open && !connectedSandboxId) return null

  const waitingForSandbox = open && !connectedSandboxId
  const statusLabel = waitingForSandbox
    ? "Waiting"
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
            <TerminalTab
              key={session.id}
              session={session}
              active={session.id === activeSession?.id}
              editing={editingId === session.id}
              onSelect={() => selectTerminalWindow(session.id)}
              onStartRename={() => {
                setMenu(null)
                setEditingId(session.id)
              }}
              onCancelRename={() => setEditingId(null)}
              onCommitRename={(label) => {
                renameTerminalWindow(session.id, label)
                setEditingId(null)
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
                palette={palette}
                sandboxId={connectedSandboxId}
                session={session}
                onStatusChange={handleSessionStatusChange}
              />
            ))
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
              onSelect: () => setEditingId(menu.terminalId),
            },
            {
              label: "Delete",
              destructive: true,
              disabled: sessions.length <= 1,
              onSelect: () => closeTerminalWindow(menu.terminalId),
            },
          ]}
        />
      ) : null}
    </section>
  )
}

function TerminalTab({
  active,
  editing,
  session,
  onSelect,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onContextMenu,
}: {
  active: boolean
  editing: boolean
  session: TerminalWindow
  onSelect: () => void
  onStartRename: () => void
  onCancelRename: () => void
  onCommitRename: (label: string) => void
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
}) {
  const [draft, setDraft] = useState(session.label)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!editing) return
    setDraft(session.label)
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [editing, session.label])

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
          ref={inputRef}
          variant="bare"
          aria-label={`Rename ${session.label}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => onCommitRename(e.currentTarget.value)}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              onCommitRename(e.currentTarget.value)
            } else if (e.key === "Escape") {
              e.preventDefault()
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

function SandboxTerminalPane({
  active,
  palette,
  sandboxId,
  session,
  onStatusChange,
}: {
  active: boolean
  palette: TerminalPalette
  sandboxId: string
  session: TerminalWindow
  onStatusChange: (terminalId: string, state: TerminalSessionState) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const activeRef = useRef(active)
  const paletteRef = useRef<TerminalPalette>(palette)
  const scheduleResizeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    paletteRef.current = palette
    if (terminalRef.current) {
      terminalRef.current.options.theme = palette
    }
  }, [palette])

  useEffect(() => {
    if (!active) return

    const frame = requestAnimationFrame(() => {
      scheduleResizeRef.current?.()
      terminalRef.current?.focus()
    })

    return () => cancelAnimationFrame(frame)
  }, [active])

  useEffect(() => {
    if (!containerRef.current) return

    const sessionSandboxId = sandboxId
    const terminalId = session.id
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      fontFamily:
        '"JetBrains Mono", "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
      fontSize: 13,
      fontWeight: "400",
      fontWeightBold: "600",
      letterSpacing: 0.2,
      lineHeight: 1.35,
      macOptionIsMeta: true,
      minimumContrastRatio: 4,
      scrollback: 10_000,
      smoothScrollDuration: 0,
      theme: paletteRef.current,
    })
    terminalRef.current = terminal
    const fitAddon = new FitAddon()
    const node = containerRef.current
    let disposed = false
    let inputFlushTimer: ReturnType<typeof setTimeout> | undefined
    let inputSendQueue = Promise.resolve()
    let pendingInput = ""
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let lastSize = { cols: 0, rows: 0 }

    function setTerminalState(
      status: TerminalStatus,
      error: string | null = null
    ) {
      onStatusChange(terminalId, { error, status })
    }

    function postTerminal(payload: Record<string, unknown>) {
      if (disposed) return Promise.resolve()
      return fetch("/api/sandbox/terminal/pty", {
        body: JSON.stringify({
          sandboxId: sessionSandboxId,
          terminalId,
          ...payload,
        }),
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }).then(async (res) => {
        if (res.ok) return
        const data = (await res.json().catch(() => undefined)) as
          | { error?: unknown }
          | undefined
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Terminal request failed."
        )
      })
    }

    function sendInput(data: string) {
      const send = inputSendQueue.then(() => postTerminal({ data }))
      inputSendQueue = send.catch(() => undefined)

      return send.catch((err) => {
        if (disposed) return
        setTerminalState(
          "error",
          err instanceof Error ? err.message : "Terminal input failed."
        )
        throw err
      })
    }
    function flushInput() {
      if (!pendingInput || disposed) return
      const data = pendingInput
      pendingInput = ""
      void sendInput(data).catch(() => undefined)
    }

    function sendResize() {
      if (disposed || !activeRef.current) return
      try {
        fitAddon.fit()
      } catch {
        return
      }

      const cols = terminal.cols
      const rows = terminal.rows
      if (!cols || !rows) return
      if (cols === lastSize.cols && rows === lastSize.rows) return
      lastSize = { cols, rows }
      void postTerminal({ action: "resize", cols, rows }).catch(() => {
        // The initial resize can race the PTY connection; the GET request also
        // carries the first size, so missing this one is harmless.
      })
    }

    function scheduleResize() {
      if (!activeRef.current) return
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(sendResize, 50)
    }
    scheduleResizeRef.current = scheduleResize

    function killTerminal() {
      void killBrowserTerminalSession(sessionSandboxId, terminalId)
    }

    const unregisterCloser = registerTerminalCloser(
      sessionSandboxId,
      terminalId,
      killTerminal
    )

    function queueInput(data: string) {
      pendingInput += data
      if (inputFlushTimer) return
      inputFlushTimer = setTimeout(() => {
        inputFlushTimer = undefined
        flushInput()
      }, TERMINAL_INPUT_FLUSH_DELAY_MS)
    }

    const dataDisposable = terminal.onData(queueInput)

    // xterm.js doesn't translate Option/Cmd + Arrow/Backspace to readline word/line edits.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true
      const { altKey, ctrlKey, metaKey, shiftKey } = event

      if (altKey && !ctrlKey && !metaKey) {
        let seq: string | undefined
        if (event.key === "ArrowLeft") seq = "\x1bb"
        else if (event.key === "ArrowRight") seq = "\x1bf"
        else if (event.key === "Backspace") seq = "\x1b\x7f"
        else if (event.key === "Delete") seq = "\x1bd"
        if (seq) {
          event.preventDefault()
          queueInput(seq)
          return false
        }
      }

      if (metaKey && !ctrlKey && !altKey && !shiftKey) {
        let seq: string | undefined
        if (event.key === "ArrowLeft") seq = "\x01"
        else if (event.key === "ArrowRight") seq = "\x05"
        else if (event.key === "Backspace") seq = "\x15"
        else if (event.key === "Delete") seq = "\x0b"
        if (seq) {
          event.preventDefault()
          queueInput(seq)
          return false
        }
      }

      return true
    })
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(scheduleResize)

    terminal.loadAddon(fitAddon)
    terminal.open(node)
    focusTerminal()
    resizeObserver?.observe(node)
    window.addEventListener("resize", scheduleResize)

    try {
      fitAddon.fit()
      lastSize = { cols: terminal.cols, rows: terminal.rows }
    } catch {
      lastSize = { cols: 100, rows: 30 }
    }

    const params = new URLSearchParams({
      cols: String(lastSize.cols || 100),
      rows: String(lastSize.rows || 30),
      sandboxId: sessionSandboxId,
      terminalId,
    })

    setTerminalState("connecting")

    const eventSource = new EventSource(`/api/sandbox/terminal/pty?${params}`)
    eventSource.onmessage = (event) => {
      if (disposed) return
      let message: { data?: unknown; error?: unknown; type?: unknown }
      try {
        message = JSON.parse(event.data) as {
          data?: unknown
          error?: unknown
          type?: unknown
        }
      } catch {
        return
      }

      if (message.type === "ready") {
        setTerminalState("ready")
        focusTerminal()
        return
      }

      if (message.type === "data" && typeof message.data === "string") {
        const binary = atob(message.data)
        if (!binary) return

        const bytes = bytesFromBinary(binary)
        terminal.write(bytes)
        return
      }

      if (message.type === "error") {
        const detail =
          typeof message.error === "string"
            ? message.error
            : "Unable to connect Daytona terminal."
        setTerminalState("error", detail)
        terminal.writeln(`\r\n${detail}`)
        eventSource.close()
      }
    }
    eventSource.onerror = () => {
      if (disposed || eventSource.readyState === EventSource.CLOSED) return
      setTerminalState("reconnecting")
    }

    return () => {
      unregisterCloser()
      if (scheduleResizeRef.current === scheduleResize) {
        scheduleResizeRef.current = null
      }
      if (inputFlushTimer) {
        clearTimeout(inputFlushTimer)
        inputFlushTimer = undefined
      }
      if (resizeTimer) clearTimeout(resizeTimer)
      flushInput()
      disposed = true
      dataDisposable.dispose()
      resizeObserver?.disconnect()
      window.removeEventListener("resize", scheduleResize)
      eventSource.close()
      terminal.dispose()
      if (terminalRef.current === terminal) terminalRef.current = null
    }
    // palette is applied via a separate effect; we intentionally don't recreate
    // the terminal when the theme changes.
  }, [onStatusChange, sandboxId, session.id, session.restartKey])

  function bytesFromBinary(binary: string) {
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  function shouldFocusTerminal() {
    if (!activeRef.current) return false

    const activeElement = document.activeElement
    const terminalElement = terminalRef.current?.element
    if (!activeElement || activeElement === document.body) return true
    if (terminalElement?.contains(activeElement)) return true

    return !isEditableElement(activeElement)
  }

  function focusTerminal() {
    requestAnimationFrame(() => {
      if (shouldFocusTerminal()) terminalRef.current?.focus()
    })
  }

  function focusTerminalFromPointer() {
    if (!activeRef.current) return
    terminalRef.current?.focus()
  }

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
