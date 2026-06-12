import {
  persistedTerminalIdsForSandbox,
  removePersistedTerminalSessions,
} from "@/components/sandbox/terminal-storage"
import { requestJson } from "@/lib/http/client-json"

const terminalClosers = new Map<string, Set<() => void>>()
const terminalIds = new Map<string, Set<string>>()

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

  return requestJson<void>(
    "/api/sandbox/terminal/ws",
    "DELETE",
    { sandboxId, terminalId },
    { init: { cache: "no-store" } }
  ).catch(() => undefined)
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
