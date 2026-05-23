const terminalClosers = new Map<string, Set<() => void>>()

export function registerTerminalCloser(sandboxId: string, close: () => void) {
  const closers = terminalClosers.get(sandboxId) ?? new Set<() => void>()
  closers.add(close)
  terminalClosers.set(sandboxId, closers)

  return () => {
    closers.delete(close)
    if (closers.size === 0) terminalClosers.delete(sandboxId)
  }
}

export function warmBrowserTerminal(sandboxId?: string | null) {
  void sandboxId
  // Daytona PTYs are opened on demand when the panel mounts.
}

export function closeBrowserTerminalSession(sandboxId?: string) {
  if (!sandboxId) return
  for (const close of terminalClosers.get(sandboxId) ?? []) close()
}
