const terminalClosers = new Map<string, Set<() => void>>()
const terminalIds = new Map<string, Set<string>>()
const TERMINAL_DOCK_KEY = "cloudcode:terminalDock:v1"
const TERMINAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/
export const WARM_BROWSER_TERMINAL_EVENT = "cloudcode:warmBrowserTerminal"

function persistedTerminalIdsForSandbox(sandboxId: string) {
  if (typeof window === "undefined") return []

  try {
    const raw = localStorage.getItem(TERMINAL_DOCK_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as {
      sessionsBySandbox?: Record<string, Array<{ id?: unknown }>>
    }
    const sessions = parsed.sessionsBySandbox?.[sandboxId]
    if (!Array.isArray(sessions)) return []

    return sessions
      .map((session) => (typeof session.id === "string" ? session.id : ""))
      .filter((id) => TERMINAL_ID_PATTERN.test(id))
  } catch {
    return []
  }
}

function removePersistedTerminalSessions(sandboxId: string) {
  if (typeof window === "undefined") return

  try {
    const raw = localStorage.getItem(TERMINAL_DOCK_KEY)
    if (!raw) return

    const parsed = JSON.parse(raw) as {
      activeBySandbox?: Record<string, string>
      sessionsBySandbox?: Record<string, unknown>
    }
    const activeBySandbox = { ...parsed.activeBySandbox }
    const sessionsBySandbox = { ...parsed.sessionsBySandbox }
    delete activeBySandbox[sandboxId]
    delete sessionsBySandbox[sandboxId]

    if (Object.keys(sessionsBySandbox).length === 0) {
      localStorage.removeItem(TERMINAL_DOCK_KEY)
      return
    }

    localStorage.setItem(
      TERMINAL_DOCK_KEY,
      JSON.stringify({ activeBySandbox, sessionsBySandbox })
    )
  } catch {
    // Persistence cleanup is best-effort; sandbox cleanup continues below.
  }
}

function rememberTerminalSession(sandboxId: string, terminalId: string) {
  const ids = terminalIds.get(sandboxId) ?? new Set<string>()
  ids.add(terminalId)
  terminalIds.set(sandboxId, ids)
}

function forgetTerminalSession(sandboxId: string, terminalId: string) {
  const ids = terminalIds.get(sandboxId)
  if (!ids) return
  ids.delete(terminalId)
  if (ids.size === 0) terminalIds.delete(sandboxId)
}

export function killBrowserTerminalSession(
  sandboxId: string,
  terminalId: string,
  options: { forget?: boolean } = {}
) {
  if (options.forget !== false) {
    forgetTerminalSession(sandboxId, terminalId)
  }

  return fetch("/api/sandbox/terminal/pty", {
    body: JSON.stringify({ sandboxId, terminalId }),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "DELETE",
  }).catch(() => undefined)
}

export function registerTerminalCloser(
  sandboxId: string,
  terminalId: string,
  close: () => void
) {
  rememberTerminalSession(sandboxId, terminalId)

  const closers = terminalClosers.get(sandboxId) ?? new Set<() => void>()
  closers.add(close)
  terminalClosers.set(sandboxId, closers)

  return () => {
    closers.delete(close)
    if (closers.size === 0) terminalClosers.delete(sandboxId)
  }
}

export function warmBrowserTerminal(sandboxId?: string | null) {
  if (typeof window === "undefined") return

  const warmSandboxId = sandboxId?.trim()
  if (!warmSandboxId) return

  window.dispatchEvent(
    new CustomEvent(WARM_BROWSER_TERMINAL_EVENT, {
      detail: { sandboxId: warmSandboxId },
    })
  )
}

export function closeBrowserTerminalSession(sandboxId?: string) {
  if (!sandboxId) return
  const ids = new Set([
    ...(terminalIds.get(sandboxId) ?? []),
    ...persistedTerminalIdsForSandbox(sandboxId),
  ])

  for (const close of terminalClosers.get(sandboxId) ?? []) close()
  for (const terminalId of ids) {
    void killBrowserTerminalSession(sandboxId, terminalId)
  }
  terminalClosers.delete(sandboxId)
  terminalIds.delete(sandboxId)
  removePersistedTerminalSessions(sandboxId)
}
