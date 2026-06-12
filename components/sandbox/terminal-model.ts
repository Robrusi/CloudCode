import {
  emptyTerminalDock,
  readPersistedTerminalDock,
  TERMINAL_ID_PATTERN,
  writePersistedTerminalDock,
} from "@/components/sandbox/terminal-storage"

export type TerminalStatus = "connecting" | "ready" | "reconnecting" | "error"

export type TerminalPalette = {
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

export type TerminalWindow = {
  id: string
  label: string
  restartKey: number
}

export type TerminalDockState = {
  activeBySandbox: Record<string, string>
  sessionsBySandbox: Record<string, TerminalWindow[]>
}

export type TerminalDockAction =
  | {
      type: "connect-sandbox"
      createTerminal: (sandboxId: string) => TerminalWindow
      sandboxId: string
    }
  | { type: "add"; sandboxId: string; terminal: TerminalWindow }
  | { type: "close"; sandboxId: string; terminalId: string }
  | { type: "rename"; label: string; sandboxId: string; terminalId: string }
  | { type: "restart"; sandboxId: string; terminalId: string }
  | { type: "select"; sandboxId: string; terminalId: string }

export type MountedTerminalState = Record<string, Record<string, true>>

export type TerminalSessionState = {
  error: string | null
  status: TerminalStatus
}

export const TERMINAL_INPUT_FLUSH_DELAY_MS = 10

export const darkPalette: TerminalPalette = {
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

export const lightPalette: TerminalPalette = {
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

export function createTerminalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `cloudcode-${crypto.randomUUID()}`
  }
  return `cloudcode-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`
}

export function terminalStatusLabel(state: TerminalSessionState | undefined) {
  if (!state) return "Starting"
  if (state.status === "ready") return "Connected"
  if (state.status === "reconnecting") return "Reconnecting"
  if (state.status === "error") return state.error ?? "Connection issue"
  return "Connecting"
}

export function loadPersistedTerminalDock(): TerminalDockState {
  if (typeof window === "undefined") {
    return emptyTerminalDock()
  }

  return readPersistedTerminalDock<TerminalWindow>(
    (value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null
      }
      const item = value as Record<string, unknown>
      const id = typeof item.id === "string" ? item.id : ""
      if (!TERMINAL_ID_PATTERN.test(id)) return null

      return {
        id,
        label:
          typeof item.label === "string" && item.label.trim()
            ? item.label.trim()
            : `Terminal ${index + 1}`,
        restartKey: 0,
      }
    },
    { dedupeSessionId: (session) => session.id }
  )
}

export function persistTerminalDock(dock: TerminalDockState) {
  writePersistedTerminalDock(dock, ({ id, label }) => ({ id, label }))
}

export function terminalDockReducer(
  state: TerminalDockState,
  action: TerminalDockAction
): TerminalDockState {
  switch (action.type) {
    case "add":
      return {
        activeBySandbox: {
          ...state.activeBySandbox,
          [action.sandboxId]: action.terminal.id,
        },
        sessionsBySandbox: {
          ...state.sessionsBySandbox,
          [action.sandboxId]: [
            ...(state.sessionsBySandbox[action.sandboxId] ?? []),
            action.terminal,
          ],
        },
      }
    case "close": {
      const currentSessions = state.sessionsBySandbox[action.sandboxId] ?? []
      const removedIndex = currentSessions.findIndex(
        (session) => session.id === action.terminalId
      )
      const nextSessions = currentSessions.filter(
        (session) => session.id !== action.terminalId
      )
      const nextActiveId =
        state.activeBySandbox[action.sandboxId] === action.terminalId
          ? (nextSessions[Math.max(0, removedIndex - 1)] ?? nextSessions[0])?.id
          : state.activeBySandbox[action.sandboxId]

      return {
        activeBySandbox: {
          ...state.activeBySandbox,
          ...(nextActiveId ? { [action.sandboxId]: nextActiveId } : {}),
        },
        sessionsBySandbox: {
          ...state.sessionsBySandbox,
          [action.sandboxId]: nextSessions,
        },
      }
    }
    case "connect-sandbox": {
      const sessions = state.sessionsBySandbox[action.sandboxId] ?? []
      if (sessions.length > 0) {
        const activeId = state.activeBySandbox[action.sandboxId]
        if (activeId && sessions.some((session) => session.id === activeId)) {
          return state
        }

        return {
          activeBySandbox: {
            ...state.activeBySandbox,
            [action.sandboxId]: sessions[0].id,
          },
          sessionsBySandbox: state.sessionsBySandbox,
        }
      }

      const terminal = action.createTerminal(action.sandboxId)
      return {
        activeBySandbox: {
          ...state.activeBySandbox,
          [action.sandboxId]: terminal.id,
        },
        sessionsBySandbox: {
          ...state.sessionsBySandbox,
          [action.sandboxId]: [terminal],
        },
      }
    }
    case "rename": {
      const currentSessions = state.sessionsBySandbox[action.sandboxId] ?? []
      if (
        !currentSessions.some(
          (session) =>
            session.id === action.terminalId && session.label !== action.label
        )
      ) {
        return state
      }

      return {
        activeBySandbox: state.activeBySandbox,
        sessionsBySandbox: {
          ...state.sessionsBySandbox,
          [action.sandboxId]: currentSessions.map((session) =>
            session.id === action.terminalId
              ? { ...session, label: action.label }
              : session
          ),
        },
      }
    }
    case "restart": {
      const currentSessions = state.sessionsBySandbox[action.sandboxId] ?? []
      return {
        activeBySandbox: state.activeBySandbox,
        sessionsBySandbox: {
          ...state.sessionsBySandbox,
          [action.sandboxId]: currentSessions.map((session) =>
            session.id === action.terminalId
              ? { ...session, restartKey: session.restartKey + 1 }
              : session
          ),
        },
      }
    }
    case "select":
      return {
        activeBySandbox: {
          ...state.activeBySandbox,
          [action.sandboxId]: action.terminalId,
        },
        sessionsBySandbox: state.sessionsBySandbox,
      }
  }
}

export function terminalNumbersFromDock(dock: TerminalDockState) {
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
