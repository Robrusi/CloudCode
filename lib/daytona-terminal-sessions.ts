import type { PtyHandle } from "@daytona/sdk"

import {
  daytonaTerminalPath,
  getStartedDaytonaSandbox,
  resolveDaytonaPaths,
} from "./daytona-sandbox"
import {
  configureSandboxGitHubRemote,
  setupSandboxGitHubAuth,
  type SandboxGitHubAuth,
} from "./sandbox-github-auth"

const MAX_REPLAY_BYTES = 1_000_000
const GITHUB_AUTH_VERSION = 7

type StartedDaytonaSandbox = Awaited<
  ReturnType<typeof getStartedDaytonaSandbox>
>
type DaytonaTerminalPaths = Awaited<ReturnType<typeof resolveDaytonaPaths>>
type DaytonaTerminalContext = {
  paths: DaytonaTerminalPaths
  sandbox: StartedDaytonaSandbox
}

export type TerminalSubscriber = {
  active: boolean
  onData: (data: Uint8Array) => void | Promise<void>
  queue: Uint8Array[]
}

type TerminalSession = {
  buffer: Uint8Array[]
  bufferBytes: number
  connecting?: Promise<PtyHandle>
  githubAuth?: SandboxGitHubAuth | null
  githubAuthVersion?: number
  handle?: PtyHandle
  subscribers: Set<TerminalSubscriber>
}

export type ConnectedDaytonaTerminal = {
  activate: () => void
  handle: PtyHandle
  key: string
  replay: Uint8Array[]
  subscriber: TerminalSubscriber
}

const sessions = new Map<string, TerminalSession>()

function keyFor(sandboxId: string, terminalId: string) {
  return `${sandboxId}:${terminalId}`
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function terminalSessionKey(sandboxId: string, terminalId: string) {
  return keyFor(sandboxId, cleanTerminalId(terminalId))
}

function copyBytes(data: Uint8Array) {
  return new Uint8Array(data)
}

function getSession(key: string) {
  const existing = sessions.get(key)
  if (existing) return existing

  const session: TerminalSession = {
    buffer: [],
    bufferBytes: 0,
    subscribers: new Set(),
  }
  sessions.set(key, session)
  return session
}

function appendReplayBuffer(session: TerminalSession, data: Uint8Array) {
  const chunk = copyBytes(data)
  session.buffer.push(chunk)
  session.bufferBytes += chunk.byteLength

  while (session.bufferBytes > MAX_REPLAY_BYTES) {
    const removed = session.buffer.shift()
    if (!removed) break
    session.bufferBytes -= removed.byteLength
  }
}

function emitToSubscribers(session: TerminalSession, data: Uint8Array) {
  appendReplayBuffer(session, data)

  for (const subscriber of session.subscribers) {
    if (!subscriber.active) {
      subscriber.queue.push(copyBytes(data))
      continue
    }

    void subscriber.onData(data)
  }
}

function activateSubscriber(subscriber: TerminalSubscriber) {
  subscriber.active = true
  const queued = subscriber.queue
  subscriber.queue = []

  for (const data of queued) {
    void subscriber.onData(data)
  }
}

async function connectExistingPty(
  sandbox: Awaited<ReturnType<typeof getStartedDaytonaSandbox>>,
  terminalId: string,
  onData: (data: Uint8Array) => void | Promise<void>,
  attempts = 1
) {
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await sandbox.process.connectPty(terminalId, { onData })
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) await wait(100 * (attempt + 1))
    }
  }

  throw lastError
}

export function daytonaTerminalHasCurrentGitHubAuth(
  sandboxId: string,
  terminalId: string
) {
  const session = sessions.get(terminalSessionKey(sandboxId, terminalId))
  return Boolean(
    session?.githubAuth && session.githubAuthVersion === GITHUB_AUTH_VERSION
  )
}

export async function refreshDaytonaTerminalGitHubAuth({
  githubToken,
  githubUserEmail,
  githubUserName,
  githubUsername,
  paths: providedPaths,
  repoUrl,
  sandbox: providedSandbox,
  sandboxId,
  terminalId,
}: {
  githubToken?: string
  githubUserEmail?: string
  githubUserName?: string
  githubUsername?: string | null
  paths?: DaytonaTerminalPaths
  repoUrl?: string
  sandbox?: StartedDaytonaSandbox
  sandboxId: string
  terminalId: string
}) {
  const session = getSession(terminalSessionKey(sandboxId, terminalId))

  if (session.githubAuth && session.githubAuthVersion === GITHUB_AUTH_VERSION) {
    return session.githubAuth
  }
  if (!githubToken?.trim()) return session.githubAuth ?? null

  const sandbox = providedSandbox ?? (await getStartedDaytonaSandbox(sandboxId))
  const paths = providedPaths ?? (await resolveDaytonaPaths(sandbox))
  await session.githubAuth?.cleanup()
  const auth = await setupSandboxGitHubAuth({
    githubToken,
    githubUserEmail,
    githubUserName,
    githubUsername,
    installGlobal: true,
    persistCredentials: true,
    paths,
    repoUrl,
    sandbox,
  })
  session.githubAuth = auth
  session.githubAuthVersion = auth ? GITHUB_AUTH_VERSION : undefined

  await configureSandboxGitHubRemote({
    auth,
    paths,
    sandbox,
  })

  return auth
}

export async function connectDaytonaTerminal({
  cols,
  githubToken,
  githubUserEmail,
  githubUserName,
  githubUsername,
  onData,
  repoUrl,
  rows,
  sandboxId,
  terminalId,
}: {
  cols?: number
  githubToken?: string
  githubUserEmail?: string
  githubUserName?: string
  githubUsername?: string | null
  onData: (data: Uint8Array) => void | Promise<void>
  repoUrl?: string
  rows?: number
  sandboxId: string
  terminalId: string
}) {
  const cleanId = cleanTerminalId(terminalId)
  const key = keyFor(sandboxId, cleanId)
  const session = getSession(key)
  const safeCols = cleanSize(cols, 100, 20, 300)
  const safeRows = cleanSize(rows, 30, 8, 120)

  const subscriber: TerminalSubscriber = {
    active: false,
    onData,
    queue: [],
  }

  async function attachSubscriber(handle: PtyHandle) {
    session.subscribers.add(subscriber)
    await handle.resize(safeCols, safeRows).catch(() => undefined)

    return {
      activate: () => activateSubscriber(subscriber),
      handle,
      key,
      replay: session.buffer.map(copyBytes),
      subscriber,
    }
  }

  let sandboxAndPaths: Promise<DaytonaTerminalContext> | undefined
  function getSandboxAndPaths() {
    sandboxAndPaths ??= (async () => {
      const sandbox = await getStartedDaytonaSandbox(sandboxId)
      const paths = await resolveDaytonaPaths(sandbox)
      return { paths, sandbox }
    })()

    return sandboxAndPaths
  }

  async function ensureTerminalGitHubAuth(context?: DaytonaTerminalContext) {
    return await refreshDaytonaTerminalGitHubAuth({
      githubToken,
      githubUserEmail,
      githubUserName,
      githubUsername,
      paths: context?.paths,
      repoUrl,
      sandbox: context?.sandbox,
      sandboxId,
      terminalId: cleanId,
    })
  }

  if (session.handle?.isConnected()) {
    await ensureTerminalGitHubAuth()
    return attachSubscriber(session.handle)
  }

  if (session.connecting) {
    session.handle = await session.connecting
    await ensureTerminalGitHubAuth()
    return attachSubscriber(session.handle)
  }

  async function connectHandle() {
    const context = await getSandboxAndPaths()
    const { paths, sandbox } = context
    const githubAuth = await ensureTerminalGitHubAuth(context)
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
        ...githubAuth?.env,
      },
      id: cleanId,
      onData,
      rows: safeRows,
    }
    let handle: PtyHandle
    const broadcast = (data: Uint8Array) => emitToSubscribers(session, data)
    const persistentCreateOptions = { ...createOptions, onData: broadcast }

    try {
      handle = await connectExistingPty(sandbox, cleanId, broadcast)
      await handle.resize(safeCols, safeRows).catch(() => undefined)
    } catch {
      try {
        handle = await sandbox.process.createPty({
          ...persistentCreateOptions,
          cwd: paths.repoPath,
        })
      } catch {
        try {
          handle = await connectExistingPty(sandbox, cleanId, broadcast, 5)
        } catch {
          try {
            handle = await sandbox.process.createPty({
              ...persistentCreateOptions,
              cwd: paths.home,
            })
          } catch {
            handle = await connectExistingPty(sandbox, cleanId, broadcast, 5)
          }
        }
      }
    }

    session.githubAuth = githubAuth
    session.githubAuthVersion = githubAuth ? GITHUB_AUTH_VERSION : undefined
    return handle
  }

  if (!session.handle?.isConnected()) {
    session.connecting ??= connectHandle().then(
      (handle) => {
        session.handle = handle
        session.connecting = undefined
        return handle
      },
      async (error: unknown) => {
        session.connecting = undefined
        throw error
      }
    )
    session.handle = await session.connecting
  }

  return attachSubscriber(session.handle)
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
  const session = sessions.get(key)
  let handle = session?.handle
  if (!handle?.isConnected() && session?.connecting) {
    handle = await session.connecting
  }

  if (handle?.isConnected()) {
    await handle.sendInput(data)
    return
  }

  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  const cleanId = cleanTerminalId(terminalId)
  const onData = session
    ? (chunk: Uint8Array) => emitToSubscribers(session, chunk)
    : () => undefined
  const detachedHandle = await sandbox.process.connectPty(cleanId, { onData })
  if (session) session.handle = detachedHandle

  try {
    await detachedHandle.sendInput(data)
  } finally {
    if (!session) await detachedHandle.disconnect().catch(() => undefined)
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
  const session = sessions.get(key)
  let handle = session?.handle
  if (!handle?.isConnected() && session?.connecting) {
    handle = await session.connecting
  }

  if (handle?.isConnected()) {
    await handle.resize(safeCols, safeRows)
    return
  }

  if (session) {
    const sandbox = await getStartedDaytonaSandbox(sandboxId)
    const cleanId = cleanTerminalId(terminalId)
    const connectedHandle = await sandbox.process.connectPty(cleanId, {
      onData: (data) => emitToSubscribers(session, data),
    })
    session.handle = connectedHandle
    await connectedHandle.resize(safeCols, safeRows)
    return
  }

  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await sandbox.process.resizePtySession(
    cleanTerminalId(terminalId),
    safeCols,
    safeRows
  )
}

export async function detachDaytonaTerminal(
  sandboxId: string,
  terminalId: string,
  subscriber?: TerminalSubscriber
) {
  const key = terminalSessionKey(sandboxId, terminalId)
  const session = sessions.get(key)
  if (!session || !subscriber) return

  session.subscribers.delete(subscriber)
}

export async function killDaytonaTerminal(
  sandboxId: string,
  terminalId: string
) {
  const key = terminalSessionKey(sandboxId, terminalId)
  const session = sessions.get(key)
  sessions.delete(key)
  let handle = session?.handle
  if (!handle && session?.connecting) {
    handle = await session.connecting.catch(() => undefined)
  }

  if (handle) {
    await handle.kill().catch(() => undefined)
    await handle.disconnect().catch(() => undefined)
    return
  }

  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await sandbox.process
    .killPtySession(cleanTerminalId(terminalId))
    .catch(() => {
      // The PTY may already be gone.
    })
}
