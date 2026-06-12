import {
  readBrowserStorage,
  removeBrowserStorage,
  writeBrowserStorage,
} from "@/lib/browser/storage"

type PersistedTerminalDock<TSession> = {
  activeBySandbox: Record<string, string>
  sessionsBySandbox: Record<string, TSession[]>
}

const TERMINAL_DOCK_KEY = "cloudcode:terminalDock:v1"
export const TERMINAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function emptyTerminalDock<TSession>(): PersistedTerminalDock<TSession> {
  return { activeBySandbox: {}, sessionsBySandbox: {} }
}

export function readPersistedTerminalDock<TSession>(
  parseSession: (value: unknown, index: number) => TSession | null,
  options: { dedupeSessionId?: (session: TSession) => string } = {}
): PersistedTerminalDock<TSession> {
  try {
    const raw = readBrowserStorage(TERMINAL_DOCK_KEY)
    if (!raw) return emptyTerminalDock()

    const parsed = JSON.parse(raw) as unknown
    if (!isPlainRecord(parsed)) return emptyTerminalDock()

    const persistedSessions = isPlainRecord(parsed.sessionsBySandbox)
      ? parsed.sessionsBySandbox
      : {}
    const persistedActive = isPlainRecord(parsed.activeBySandbox)
      ? parsed.activeBySandbox
      : {}
    const sessionsBySandbox: Record<string, TSession[]> = {}
    const activeBySandbox: Record<string, string> = {}

    for (const [sandboxId, value] of Object.entries(persistedSessions)) {
      if (!sandboxId || !Array.isArray(value)) continue

      const seen = new Set<string>()
      const sessions: TSession[] = []
      for (const item of value) {
        const session = parseSession(item, sessions.length)
        if (!session) continue

        const id = options.dedupeSessionId?.(session)
        if (id) {
          if (seen.has(id)) continue
          seen.add(id)
        }
        sessions.push(session)
      }

      if (sessions.length === 0) continue
      sessionsBySandbox[sandboxId] = sessions

      const activeId = persistedActive[sandboxId]
      activeBySandbox[sandboxId] =
        typeof activeId === "string" &&
        sessions.some(
          (session) => options.dedupeSessionId?.(session) === activeId
        )
          ? activeId
          : (options.dedupeSessionId?.(sessions[0]) ?? "")
    }

    return { activeBySandbox, sessionsBySandbox }
  } catch {
    return emptyTerminalDock()
  }
}

export function writePersistedTerminalDock<TSession>(
  dock: PersistedTerminalDock<TSession>,
  serializeSession: (session: TSession) => { id: string; label: string }
) {
  try {
    const sessionsBySandbox: Record<
      string,
      Array<{ id: string; label: string }>
    > = {}
    for (const [sandboxId, sessions] of Object.entries(
      dock.sessionsBySandbox
    )) {
      if (sessions.length === 0) continue
      sessionsBySandbox[sandboxId] = sessions.map(serializeSession)
    }

    if (Object.keys(sessionsBySandbox).length === 0) {
      removeBrowserStorage(TERMINAL_DOCK_KEY)
      return
    }

    writeBrowserStorage(
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

export function persistedTerminalIdsForSandbox(sandboxId: string) {
  const dock = readPersistedTerminalDock(
    (value) => {
      if (!isPlainRecord(value)) return null
      const id = typeof value.id === "string" ? value.id : ""
      return TERMINAL_ID_PATTERN.test(id) ? { id } : null
    },
    { dedupeSessionId: (session) => session.id }
  )

  return dock.sessionsBySandbox[sandboxId]?.map((session) => session.id) ?? []
}

export function removePersistedTerminalSessions(sandboxId: string) {
  try {
    const raw = readBrowserStorage(TERMINAL_DOCK_KEY)
    if (!raw) return

    const parsed = JSON.parse(raw) as unknown
    if (!isPlainRecord(parsed)) return

    const activeBySandbox = isPlainRecord(parsed.activeBySandbox)
      ? { ...parsed.activeBySandbox }
      : {}
    const sessionsBySandbox = isPlainRecord(parsed.sessionsBySandbox)
      ? { ...parsed.sessionsBySandbox }
      : {}
    delete activeBySandbox[sandboxId]
    delete sessionsBySandbox[sandboxId]

    if (Object.keys(sessionsBySandbox).length === 0) {
      removeBrowserStorage(TERMINAL_DOCK_KEY)
      return
    }

    writeBrowserStorage(
      TERMINAL_DOCK_KEY,
      JSON.stringify({ activeBySandbox, sessionsBySandbox })
    )
  } catch {
    // Persistence cleanup is best-effort; sandbox cleanup continues below.
  }
}
