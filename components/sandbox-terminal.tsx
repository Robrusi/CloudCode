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
import {
  killBrowserTerminalSession,
  registerTerminalCloser,
  WARM_BROWSER_TERMINAL_EVENT,
} from "@/components/sandbox-terminal-session"
import { cn } from "@/lib/utils"

type TerminalStatus = "connecting" | "ready" | "reconnecting" | "error"
type TerminalInputMode = "direct" | "compose"

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
const TERMINAL_INPUT_MODE_KEY = "cloudcode:terminalInputMode:v1"
const TERMINAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/
const TERMINAL_RECENT_TEXT_LIMIT = 4000
const TERMINAL_SHELL_PROMPT_PATTERN = /(?:➜|❯|›).*(?:\$|#)\s*$/

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

function loadPersistedTerminalInputMode(): TerminalInputMode {
  if (typeof window === "undefined") return "direct"

  try {
    const value = localStorage.getItem(TERMINAL_INPUT_MODE_KEY)
    return value === "compose" ? "compose" : "direct"
  } catch {
    return "direct"
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

function persistTerminalInputMode(inputMode: TerminalInputMode) {
  if (typeof window === "undefined") return

  try {
    localStorage.setItem(TERMINAL_INPUT_MODE_KEY, inputMode)
  } catch {
    // Input mode persistence is convenience-only.
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
  const [inputMode, setInputMode] = useState<TerminalInputMode>(
    loadPersistedTerminalInputMode
  )
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
    persistTerminalInputMode(inputMode)
  }, [inputMode])

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
      className="absolute inset-x-0 bottom-0 z-20 flex min-h-0 flex-col overflow-hidden border-t border-border/60 bg-background text-foreground"
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
          <button
            type="button"
            onClick={addTerminalWindow}
            disabled={!connectedSandboxId}
            aria-label="New terminal"
            title="New terminal"
            className="ml-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-40"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <TerminalInputModeToggle value={inputMode} onChange={setInputMode} />
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
              <CircleDot className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : statusIsError ? (
              <OctagonX className="size-3.5 shrink-0" />
            ) : (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            )}
            <span className="truncate">{statusLabel}</span>
          </span>
          <button
            type="button"
            onClick={reconnectActiveTerminal}
            disabled={!activeSession}
            aria-label="Reconnect terminal"
            title="Reconnect terminal"
            className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-40"
          >
            <RefreshCw className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide terminal dock"
            title="Hide terminal dock"
            className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-hidden px-3 pt-3 pb-1"
        style={{ background: palette.background, color: palette.foreground }}
      >
        <div className="relative h-full w-full overflow-hidden">
          {connectedSandboxId && sessions.length > 0 ? (
            renderSessions.map((session) => (
              <SandboxTerminalPane
                key={`${connectedSandboxId}:${session.id}:${session.restartKey}`}
                active={open && session.id === activeSession?.id}
                palette={palette}
                inputMode={inputMode}
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

function TerminalInputModeToggle({
  value,
  onChange,
}: {
  value: TerminalInputMode
  onChange: (value: TerminalInputMode) => void
}) {
  return (
    <fieldset className="mr-1 grid h-7 grid-cols-2 overflow-hidden rounded-md border border-border/70 bg-muted/40 p-0.5 text-[11px] font-medium">
      <legend className="sr-only">Terminal input mode</legend>
      {(["direct", "compose"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            "h-5 min-w-14 rounded-[5px] px-2 leading-none text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
            value === mode && "bg-background text-foreground shadow-xs"
          )}
        >
          {mode === "direct" ? "Direct" : "Compose"}
        </button>
      ))}
    </fieldset>
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
        <input
          ref={inputRef}
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
          className="w-28 min-w-0 bg-transparent p-0 text-xs text-foreground outline-none"
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
  inputMode,
  palette,
  sandboxId,
  session,
  onStatusChange,
}: {
  active: boolean
  inputMode: TerminalInputMode
  palette: TerminalPalette
  sandboxId: string
  session: TerminalWindow
  onStatusChange: (terminalId: string, state: TerminalSessionState) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const composeCursorRef = useRef(0)
  const composeDraftRef = useRef("")
  const composeHistoryDraftRef = useRef("")
  const composeHistoryRef = useRef<string[]>([])
  const composeHistoryIndexRef = useRef<number | null>(null)
  const composeAwaitingPromptRef = useRef(false)
  const composeInputReadyRef = useRef(false)
  const composeStartRef = useRef<{ x: number; y: number } | null>(null)
  const handleComposeKeyEventRef = useRef<(event: KeyboardEvent) => boolean>(
    () => true
  )
  const handleComposeTerminalDataRef = useRef<(data: string) => void>(
    () => undefined
  )
  const pendingRemoteEchoRef = useRef("")
  const terminalRef = useRef<Terminal | null>(null)
  const activeRef = useRef(active)
  const inputModeRef = useRef<TerminalInputMode>(inputMode)
  const paletteRef = useRef<TerminalPalette>(palette)
  const scheduleResizeRef = useRef<(() => void) | null>(null)
  const sendInputRef = useRef<(data: string) => void>(() => undefined)
  const terminalTextDecoderRef = useRef<TextDecoder | null>(null)
  const terminalRecentTextRef = useRef("")

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    inputModeRef.current = inputMode
    if (inputMode === "direct" && composeDraftRef.current) {
      eraseLocalComposeDraft()
      composeHistoryDraftRef.current = ""
      pendingRemoteEchoRef.current = ""
      setComposeHistoryIndexValue(null)
      composeStartRef.current = null
    }
    if (inputMode === "compose") {
      composeInputReadyRef.current =
        !composeAwaitingPromptRef.current && recentTerminalTextEndsWithPrompt()
    }
    if (!activeRef.current) return

    const frame = requestAnimationFrame(() => terminalRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [inputMode])

  useEffect(() => {
    paletteRef.current = palette
    if (terminalRef.current) {
      terminalRef.current.options.theme = palette
    }
  }, [palette])

  useEffect(() => {
    if (!active) return
    if (inputModeRef.current === "compose") {
      composeInputReadyRef.current =
        !composeAwaitingPromptRef.current && recentTerminalTextEndsWithPrompt()
    }

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
    let inputFlushScheduled = false
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
      return postTerminal({ data }).catch((err) => {
        if (disposed) return
        setTerminalState(
          "error",
          err instanceof Error ? err.message : "Terminal input failed."
        )
        throw err
      })
    }
    const sendInputFireAndForget = (data: string) => {
      void sendInput(data).catch(() => undefined)
    }
    sendInputRef.current = sendInputFireAndForget

    function flushInput() {
      if (!pendingInput || disposed) return
      const data = pendingInput
      pendingInput = ""
      sendInputRef.current(data)
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
      if (inputModeRef.current === "compose") {
        handleComposeTerminalDataRef.current(data)
        return
      }

      pendingInput += data
      if (inputFlushScheduled) return
      inputFlushScheduled = true
      queueMicrotask(() => {
        inputFlushScheduled = false
        flushInput()
      })
    }

    const dataDisposable = terminal.onData(queueInput)

    // xterm.js doesn't translate Option/Cmd + Arrow/Backspace to readline word/line edits.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true
      if (inputModeRef.current === "compose") {
        return handleComposeKeyEventRef.current(event)
      }
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
    if (activeRef.current) terminal.focus()
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
        composeInputReadyRef.current =
          !composeAwaitingPromptRef.current &&
          recentTerminalTextEndsWithPrompt()
        if (activeRef.current) terminal.focus()
        return
      }

      if (message.type === "data" && typeof message.data === "string") {
        const binary = filterSuppressedRemoteEcho(atob(message.data))
        if (!binary) return

        const bytes = bytesFromBinary(binary)
        const promptReady = rememberRemoteTerminalText(bytes)
        if (inputModeRef.current === "compose") {
          if (composeDraftRef.current) discardComposeDraftForRemoteOutput()
          if (!promptReady) composeInputReadyRef.current = false
        }
        terminal.write(bytes, () => {
          if (!promptReady) return

          composeAwaitingPromptRef.current = false
          composeInputReadyRef.current = true
        })
        return
      }

      if (message.type === "error") {
        composeAwaitingPromptRef.current = false
        composeInputReadyRef.current = false
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
      composeInputReadyRef.current = false
      setTerminalState("reconnecting")
    }

    return () => {
      unregisterCloser()
      if (scheduleResizeRef.current === scheduleResize) {
        scheduleResizeRef.current = null
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
      if (sendInputRef.current === sendInputFireAndForget) {
        sendInputRef.current = () => undefined
      }
    }
    // palette is applied via a separate effect; we intentionally don't recreate
    // the terminal when the theme changes.
  }, [onStatusChange, sandboxId, session.id, session.restartKey])

  function utf8Binary(value: string) {
    const bytes = new TextEncoder().encode(value)
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return binary
  }

  function bytesFromBinary(binary: string) {
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  function filterSuppressedRemoteEcho(binary: string) {
    let pending = pendingRemoteEchoRef.current
    if (!pending) return binary

    let remaining = binary
    while (pending && remaining) {
      let length = 0
      while (
        length < pending.length &&
        length < remaining.length &&
        pending.charCodeAt(length) === remaining.charCodeAt(length)
      ) {
        length += 1
      }

      if (length === 0) {
        pending = ""
        break
      }

      pending = pending.slice(length)
      remaining = remaining.slice(length)
    }

    pendingRemoteEchoRef.current = pending
    return remaining
  }

  function stripTerminalControlSequences(value: string) {
    let result = ""
    let index = 0

    while (index < value.length) {
      const code = value.charCodeAt(index)
      if (code !== 0x1b) {
        if (code !== 0x07) result += value[index] ?? ""
        index += 1
        continue
      }

      const next = value[index + 1]
      if (next === "]") {
        index += 2
        while (index < value.length) {
          const current = value.charCodeAt(index)
          if (current === 0x07) {
            index += 1
            break
          }
          if (current === 0x1b && value[index + 1] === "\\") {
            index += 2
            break
          }
          index += 1
        }
        continue
      }

      if (next === "[") {
        index += 2
        while (index < value.length) {
          const current = value.charCodeAt(index)
          index += 1
          if (current >= 0x40 && current <= 0x7e) break
        }
        continue
      }

      index += next === "=" || next === ">" ? 2 : 1
    }

    return result
  }

  function terminalTextDecoder() {
    terminalTextDecoderRef.current ??= new TextDecoder()
    return terminalTextDecoderRef.current
  }

  function rememberRemoteTerminalText(bytes: Uint8Array) {
    const text = terminalTextDecoder().decode(bytes, { stream: true })
    if (!text) return false

    const plain = stripTerminalControlSequences(text).replaceAll("\r", "\n")
    if (!plain) return false

    terminalRecentTextRef.current = (
      terminalRecentTextRef.current + plain
    ).slice(-TERMINAL_RECENT_TEXT_LIMIT)

    return recentTerminalTextEndsWithPrompt()
  }

  function recentTerminalTextEndsWithPrompt() {
    const lines = terminalRecentTextRef.current.split("\n")
    const lastLine = lines.at(-1) ?? ""
    return TERMINAL_SHELL_PROMPT_PATTERN.test(lastLine)
  }

  function canEditComposeInput() {
    return inputModeRef.current === "compose" && composeInputReadyRef.current
  }

  function interruptBusyComposeInput() {
    composeAwaitingPromptRef.current = true
    composeInputReadyRef.current = false
    pendingRemoteEchoRef.current = ""
    sendInputRef.current("\x03")
  }

  function shouldInterruptBusyComposeInput(data: string) {
    return data.includes("\x03")
  }

  function discardComposeDraftForRemoteOutput() {
    if (!composeDraftRef.current) return

    eraseLocalComposeDraft()
    composeHistoryDraftRef.current = ""
    setComposeHistoryIndexValue(null)
    composeStartRef.current = null
  }

  function composeChars(value = composeDraftRef.current) {
    return Array.from(value)
  }

  function composeLength(value = composeDraftRef.current) {
    return composeChars(value).length
  }

  function composeText(chars: string[]) {
    return chars.join("")
  }

  function clampComposeCursor(value: number, draft = composeDraftRef.current) {
    return Math.min(composeLength(draft), Math.max(0, value))
  }

  function composeStart() {
    const terminal = terminalRef.current
    const existing = composeStartRef.current
    if (existing || !terminal) return existing

    const start = {
      x: Math.min(terminal.cols - 1, terminal.buffer.active.cursorX),
      y: terminal.buffer.active.cursorY,
    }
    composeStartRef.current = start
    return start
  }

  function composePosition(offset: number) {
    const terminal = terminalRef.current
    const start = composeStart()
    if (!terminal || !start) return null

    const cols = Math.max(1, terminal.cols)
    const absolute = start.x + Math.max(0, offset)
    return {
      x: absolute % cols,
      y: start.y + Math.floor(absolute / cols),
    }
  }

  function adjustComposeStartForLength(length = composeLength()) {
    const terminal = terminalRef.current
    const start = composeStartRef.current
    if (!terminal || !start) return

    const cols = Math.max(1, terminal.cols)
    const endY = start.y + Math.floor((start.x + length) / cols)
    if (endY < terminal.rows) return

    start.y = Math.max(0, start.y - (endY - terminal.rows + 1))
  }

  function writeCursorMove(from: number, to: number) {
    const terminal = terminalRef.current
    const next = composePosition(to)
    if (!terminal || !next || from === to) return

    const row = Math.max(1, Math.min(terminal.rows, next.y + 1))
    const col = Math.max(1, Math.min(terminal.cols, next.x + 1))
    terminal.write(`\x1b[${row};${col}H`)
  }

  function moveComposeCursorTo(nextCursor: number) {
    const next = clampComposeCursor(nextCursor)
    writeCursorMove(composeCursorRef.current, next)
    composeCursorRef.current = next
  }

  function isComposeWordCharacter(character: string) {
    return /^[A-Za-z0-9_]$/.test(character)
  }

  function previousComposeWordIndex() {
    const chars = composeChars()
    let index = composeCursorRef.current

    while (index > 0 && !isComposeWordCharacter(chars[index - 1] ?? "")) {
      index -= 1
    }
    while (index > 0 && isComposeWordCharacter(chars[index - 1] ?? "")) {
      index -= 1
    }

    return index
  }

  function nextComposeWordIndex() {
    const chars = composeChars()
    let index = composeCursorRef.current

    while (
      index < chars.length &&
      !isComposeWordCharacter(chars[index] ?? "")
    ) {
      index += 1
    }
    while (index < chars.length && isComposeWordCharacter(chars[index] ?? "")) {
      index += 1
    }

    return index
  }

  function setComposeDraftValue(value: string, cursor = composeLength(value)) {
    composeDraftRef.current = value
    composeCursorRef.current = clampComposeCursor(cursor, value)
  }

  function setComposeHistoryValue(value: string[]) {
    composeHistoryRef.current = value
  }

  function setComposeHistoryIndexValue(value: number | null) {
    composeHistoryIndexRef.current = value
  }

  function focusTerminal() {
    requestAnimationFrame(() => terminalRef.current?.focus())
  }

  function writeLocalCompose(value: string) {
    terminalRef.current?.write(
      value.replace(/\r\n?/g, "\n").replaceAll("\n", "\r\n")
    )
  }

  function eraseLocalComposeDraft() {
    const length = composeLength()
    if (length === 0) {
      setComposeDraftValue("")
      return
    }

    writeCursorMove(composeCursorRef.current, 0)
    terminalRef.current?.write(" ".repeat(length))
    writeCursorMove(length, 0)
    setComposeDraftValue("")
  }

  function replaceComposeDraft(nextDraft: string) {
    eraseLocalComposeDraft()
    setComposeDraftValue(nextDraft)
    writeLocalCompose(nextDraft)
    adjustComposeStartForLength(composeLength(nextDraft))
  }

  function deleteComposeRange(start: number, end: number) {
    const chars = composeChars()
    const safeStart = Math.min(chars.length, Math.max(0, start))
    const safeEnd = Math.min(chars.length, Math.max(safeStart, end))
    const removedLength = safeEnd - safeStart
    if (removedLength === 0) return

    const nextChars = [...chars.slice(0, safeStart), ...chars.slice(safeEnd)]
    const tail = chars.slice(safeEnd)
    writeCursorMove(composeCursorRef.current, safeStart)
    terminalRef.current?.write(composeText(tail) + " ".repeat(removedLength))
    writeCursorMove(safeStart + tail.length + removedLength, safeStart)
    setComposeDraftValue(composeText(nextChars), safeStart)
  }

  function insertComposeText(value: string) {
    if (!value) return

    const insert = composeChars(value)
    if (insert.length === 0) return

    const chars = composeChars()
    const cursor = composeCursorRef.current
    const tail = chars.slice(cursor)
    const nextChars = [...chars.slice(0, cursor), ...insert, ...tail]

    composeHistoryDraftRef.current = ""
    setComposeHistoryIndexValue(null)
    composeStart()
    terminalRef.current?.write(value + composeText(tail))
    adjustComposeStartForLength(nextChars.length)
    writeCursorMove(
      cursor + insert.length + tail.length,
      cursor + insert.length
    )
    setComposeDraftValue(composeText(nextChars), cursor + insert.length)
  }

  function sendComposeDraft() {
    const command = composeDraftRef.current
    if (!command) return

    const terminalInput =
      command.replace(/\r\n?/g, "\n").replaceAll("\n", "\r") + "\r"
    const expectedEcho =
      command.replace(/\r\n?/g, "\n").replaceAll("\n", "\r\n") + "\r\n"
    pendingRemoteEchoRef.current += utf8Binary(expectedEcho)
    terminalRef.current?.write("\r\n")
    composeAwaitingPromptRef.current = true
    composeInputReadyRef.current = false
    sendInputRef.current(terminalInput)
    composeStartRef.current = null
    setComposeHistoryValue(
      (() => {
        const current = composeHistoryRef.current
        if (current.at(-1) === command) return current
        return [...current.slice(-49), command]
      })()
    )
    composeHistoryDraftRef.current = ""
    setComposeHistoryIndexValue(null)
    setComposeDraftValue("", 0)
    focusTerminal()
  }

  function recallComposeHistory(direction: -1 | 1) {
    const history = composeHistoryRef.current
    if (history.length === 0) return

    const currentIndex = composeHistoryIndexRef.current
    if (direction < 0 && currentIndex === null) {
      composeHistoryDraftRef.current = composeDraftRef.current
    }

    if (direction > 0 && currentIndex === null) return

    const nextIndex =
      direction < 0
        ? currentIndex === null
          ? history.length - 1
          : Math.max(0, currentIndex - 1)
        : Math.min(history.length, (currentIndex ?? history.length) + 1)

    if (nextIndex >= history.length) {
      setComposeHistoryIndexValue(null)
      replaceComposeDraft(composeHistoryDraftRef.current)
      return
    }

    setComposeHistoryIndexValue(nextIndex)
    replaceComposeDraft(history[nextIndex] ?? "")
  }

  function backspaceComposeDraft() {
    const cursor = composeCursorRef.current
    if (cursor === 0) return
    deleteComposeRange(cursor - 1, cursor)
  }

  function deleteComposeBeforeCursor() {
    deleteComposeRange(0, composeCursorRef.current)
  }

  function deleteComposeAfterCursor() {
    deleteComposeRange(composeCursorRef.current, composeLength())
  }

  function deleteComposePreviousWord() {
    deleteComposeRange(previousComposeWordIndex(), composeCursorRef.current)
  }

  function deleteComposeNextWord() {
    deleteComposeRange(composeCursorRef.current, nextComposeWordIndex())
  }

  function handleComposeKeyEvent(event: KeyboardEvent) {
    if (event.type !== "keydown") return true
    if (!canEditComposeInput()) {
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "c"
      ) {
        interruptBusyComposeInput()
      }

      event.preventDefault()
      return false
    }

    const handled = (() => {
      const { altKey, ctrlKey, key, metaKey } = event
      const lowerKey = key.toLowerCase()

      if (metaKey && !altKey && !ctrlKey) {
        if (key === "ArrowLeft") moveComposeCursorTo(0)
        else if (key === "ArrowRight") moveComposeCursorTo(composeLength())
        else if (key === "Backspace") deleteComposeBeforeCursor()
        else if (key === "Delete") deleteComposeAfterCursor()
        else return false
        return true
      }

      if (altKey && !metaKey && !ctrlKey) {
        if (key === "ArrowLeft") moveComposeCursorTo(previousComposeWordIndex())
        else if (key === "ArrowRight")
          moveComposeCursorTo(nextComposeWordIndex())
        else if (key === "Backspace") deleteComposePreviousWord()
        else if (key === "Delete") deleteComposeNextWord()
        else return false
        return true
      }

      if (!metaKey && !altKey && !ctrlKey) {
        if (key === "ArrowLeft")
          moveComposeCursorTo(composeCursorRef.current - 1)
        else if (key === "ArrowRight")
          moveComposeCursorTo(composeCursorRef.current + 1)
        else if (key === "ArrowUp") recallComposeHistory(-1)
        else if (key === "ArrowDown") recallComposeHistory(1)
        else if (key === "Home") moveComposeCursorTo(0)
        else if (key === "End") moveComposeCursorTo(composeLength())
        else if (key === "Delete")
          deleteComposeRange(
            composeCursorRef.current,
            composeCursorRef.current + 1
          )
        else return false
        return true
      }

      if (!metaKey && !altKey && ctrlKey) {
        if (lowerKey === "a") moveComposeCursorTo(0)
        else if (lowerKey === "e") moveComposeCursorTo(composeLength())
        else if (lowerKey === "u") deleteComposeBeforeCursor()
        else if (lowerKey === "k") deleteComposeAfterCursor()
        else if (lowerKey === "w") deleteComposePreviousWord()
        else if (lowerKey === "d")
          deleteComposeRange(
            composeCursorRef.current,
            composeCursorRef.current + 1
          )
        else return false
        return true
      }

      return false
    })()

    if (!handled) return true
    event.preventDefault()
    return false
  }
  handleComposeKeyEventRef.current = handleComposeKeyEvent

  function handleComposeTerminalData(data: string) {
    if (!data) return
    if (!canEditComposeInput()) {
      if (shouldInterruptBusyComposeInput(data)) interruptBusyComposeInput()
      return
    }

    let index = 0
    while (index < data.length) {
      const rest = data.slice(index)
      if (rest.startsWith("\x1b\x7f")) {
        deleteComposePreviousWord()
        index += 2
        continue
      }
      if (rest.startsWith("\x1bb")) {
        moveComposeCursorTo(previousComposeWordIndex())
        index += 2
        continue
      }
      if (rest.startsWith("\x1bf")) {
        moveComposeCursorTo(nextComposeWordIndex())
        index += 2
        continue
      }
      if (rest.startsWith("\x1bd")) {
        deleteComposeNextWord()
        index += 2
        continue
      }
      if (rest.startsWith("\x1b[1;3D")) {
        moveComposeCursorTo(previousComposeWordIndex())
        index += 6
        continue
      }
      if (rest.startsWith("\x1b[1;3C")) {
        moveComposeCursorTo(nextComposeWordIndex())
        index += 6
        continue
      }
      if (rest.startsWith("\x1b[1;9D")) {
        moveComposeCursorTo(previousComposeWordIndex())
        index += 6
        continue
      }
      if (rest.startsWith("\x1b[1;9C")) {
        moveComposeCursorTo(nextComposeWordIndex())
        index += 6
        continue
      }
      if (rest.startsWith("\x1b[A")) {
        recallComposeHistory(-1)
        index += 3
        continue
      }
      if (rest.startsWith("\x1b[B")) {
        recallComposeHistory(1)
        index += 3
        continue
      }
      if (rest.startsWith("\x1b[C")) {
        moveComposeCursorTo(composeCursorRef.current + 1)
        index += 3
        continue
      }
      if (rest.startsWith("\x1b[D")) {
        moveComposeCursorTo(composeCursorRef.current - 1)
        index += 3
        continue
      }
      if (rest.startsWith("\x1b[H") || rest.startsWith("\x1bOH")) {
        moveComposeCursorTo(0)
        index += 3
        continue
      }
      if (rest.startsWith("\x1b[F") || rest.startsWith("\x1bOF")) {
        moveComposeCursorTo(composeLength())
        index += 3
        continue
      }
      if (rest.startsWith("\x1b[3~")) {
        deleteComposeRange(
          composeCursorRef.current,
          composeCursorRef.current + 1
        )
        index += 4
        continue
      }
      if (rest.startsWith("\x1b[")) {
        let sequenceLength = 2
        while (
          sequenceLength < rest.length &&
          "0123456789;?".includes(rest[sequenceLength] ?? "")
        ) {
          sequenceLength += 1
        }
        index += Math.min(rest.length, sequenceLength + 1)
        continue
      }

      const character = data[index]
      if (character === "\r" || character === "\n") {
        sendComposeDraft()
      } else if (character === "\x1b") {
        index += 1
        continue
      } else if (character === "\x7f" || character === "\b") {
        backspaceComposeDraft()
      } else if (character === "\x15") {
        deleteComposeBeforeCursor()
      } else if (character === "\x0b") {
        deleteComposeAfterCursor()
      } else if (character === "\x01") {
        moveComposeCursorTo(0)
      } else if (character === "\x05") {
        moveComposeCursorTo(composeLength())
      } else if (character === "\x17") {
        deleteComposePreviousWord()
      } else if (character === "\x04") {
        deleteComposeRange(
          composeCursorRef.current,
          composeCursorRef.current + 1
        )
      } else if (character === "\x03") {
        if (composeDraftRef.current) {
          setComposeHistoryIndexValue(null)
          eraseLocalComposeDraft()
          composeStartRef.current = null
        } else {
          sendInputRef.current("\x03")
        }
      } else if (character === "\t") {
        insertComposeText("\t")
      } else if (character >= " ") {
        const printable = Array.from(rest)[0] ?? character
        insertComposeText(printable)
        index += printable.length - 1
      }

      index += 1
    }
  }
  handleComposeTerminalDataRef.current = handleComposeTerminalData

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
          className="h-full w-full overflow-hidden [&_.xterm]:!bg-transparent [&_.xterm-screen]:outline-none [&_.xterm-viewport]:!bg-transparent"
          style={{ background: palette.background }}
        />
      </div>
    </div>
  )
}
