import type { PtyHandle } from "@daytona/sdk"

import {
  daytonaTerminalPath,
  getStartedDaytonaSandbox,
  resolveDaytonaPaths,
} from "./daytona-sandbox"

const sessions = new Map<string, PtyHandle>()

function keyFor(sandboxId: string, terminalId: string) {
  return `${sandboxId}:${terminalId}`
}

function cleanTerminalId(terminalId: string) {
  const trimmed = terminalId.trim()
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(trimmed)) {
    throw new Error("Invalid terminal id.")
  }
  return trimmed
}

function cleanSize(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

export function terminalSessionKey(sandboxId: string, terminalId: string) {
  return keyFor(sandboxId, cleanTerminalId(terminalId))
}

export async function connectDaytonaTerminal({
  cols,
  onData,
  rows,
  sandboxId,
  terminalId,
}: {
  cols?: number
  onData: (data: Uint8Array) => void | Promise<void>
  rows?: number
  sandboxId: string
  terminalId: string
}) {
  const cleanId = cleanTerminalId(terminalId)
  const key = keyFor(sandboxId, cleanId)
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  const paths = await resolveDaytonaPaths(sandbox)
  const safeCols = cleanSize(cols, 100, 20, 300)
  const safeRows = cleanSize(rows, 30, 8, 120)
  let handle: PtyHandle

  const createOptions = {
    cols: safeCols,
    envs: {
      CLICOLOR: "1",
      COLORTERM: "truecolor",
      CODEX_HOME: paths.codexHome,
      FORCE_COLOR: "1",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: daytonaTerminalPath(paths.home),
      TERM: "xterm-256color",
    },
    id: cleanId,
    onData,
    rows: safeRows,
  }

  try {
    handle = await sandbox.process.connectPty(cleanId, { onData })
    await handle.resize(safeCols, safeRows).catch(() => undefined)
  } catch {
    try {
      handle = await sandbox.process.createPty({
        ...createOptions,
        cwd: paths.repoPath,
      })
    } catch {
      try {
        handle = await sandbox.process.connectPty(cleanId, { onData })
      } catch {
        await sandbox.process
          .killPtySession(cleanId)
          .catch(() => undefined)
        handle = await sandbox.process.createPty({
          ...createOptions,
          cwd: paths.home,
        })
      }
    }
  }

  sessions.set(key, handle)
  return { handle, key }
}

export async function sendDaytonaTerminalInput({
  data,
  sandboxId,
  terminalId,
}: {
  data: string
  sandboxId: string
  terminalId: string
}) {
  const key = terminalSessionKey(sandboxId, terminalId)
  const handle = sessions.get(key)
  if (handle?.isConnected()) {
    await handle.sendInput(data)
    return
  }

  sessions.delete(key)
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  const detachedHandle = await sandbox.process.connectPty(
    cleanTerminalId(terminalId),
    { onData: () => undefined }
  )

  try {
    await detachedHandle.sendInput(data)
  } finally {
    await detachedHandle.disconnect().catch(() => undefined)
  }
}

export async function resizeDaytonaTerminal({
  cols,
  rows,
  sandboxId,
  terminalId,
}: {
  cols: number
  rows: number
  sandboxId: string
  terminalId: string
}) {
  const safeCols = cleanSize(cols, 100, 20, 300)
  const safeRows = cleanSize(rows, 30, 8, 120)
  const key = terminalSessionKey(sandboxId, terminalId)
  const handle = sessions.get(key)

  if (handle?.isConnected()) {
    await handle.resize(safeCols, safeRows)
    return
  }

  sessions.delete(key)
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await sandbox.process.resizePtySession(
    cleanTerminalId(terminalId),
    safeCols,
    safeRows
  )
}

export async function detachDaytonaTerminal(
  sandboxId: string,
  terminalId: string
) {
  const key = terminalSessionKey(sandboxId, terminalId)
  const handle = sessions.get(key)
  sessions.delete(key)
  await handle?.disconnect().catch(() => undefined)
}

export async function killDaytonaTerminal(
  sandboxId: string,
  terminalId: string
) {
  const key = terminalSessionKey(sandboxId, terminalId)
  const handle = sessions.get(key)
  sessions.delete(key)

  if (handle) {
    await handle.kill().catch(() => undefined)
    await handle.disconnect().catch(() => undefined)
    return
  }

  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await sandbox.process.killPtySession(cleanTerminalId(terminalId)).catch(() => {
    // The PTY may already be gone.
  })
}
