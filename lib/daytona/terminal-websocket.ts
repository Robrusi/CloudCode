import type { Sandbox } from "@daytona/sdk"
import daytonaSdkPackage from "@daytona/sdk/package.json"

import {
  daytonaTerminalPath,
  getStartedDaytonaSandbox,
  resolveDaytonaPaths,
} from "@/lib/daytona/sandbox"
import { refreshDaytonaTerminalGitHubAuth } from "@/lib/daytona/terminal-sessions"
import {
  cleanTerminalDimensions,
  cleanTerminalId,
} from "@/lib/daytona/terminal-params"

type SandboxClientConfig = {
  clientConfig?: {
    baseOptions?: {
      headers?: Record<string, unknown>
    }
  }
}

export type DaytonaTerminalWebSocket = {
  protocol: string
  sessionId: string
  wsUrl: string
}

type DaytonaTerminalSandbox = Awaited<
  ReturnType<typeof getStartedDaytonaSandbox>
>

type DaytonaTerminalWebSocketContext = {
  paths: Awaited<ReturnType<typeof resolveDaytonaPaths>>
  sandbox: DaytonaTerminalSandbox
}

const TERMINAL_CONTEXT_CACHE_TTL_MS = 30_000

const terminalSandboxCache = new Map<
  string,
  {
    expiresAt: number
    promise: Promise<DaytonaTerminalSandbox>
  }
>()

const terminalContextCache = new Map<
  string,
  {
    expiresAt: number
    promise: Promise<DaytonaTerminalWebSocketContext>
  }
>()

function toolboxBasePath(sandbox: Sandbox) {
  let baseUrl = sandbox.toolboxProxyUrl
  if (!baseUrl.endsWith("/")) baseUrl += "/"
  return `${baseUrl}${sandbox.id}`
}

function toolboxHeaders(sandbox: Sandbox) {
  const headers =
    (sandbox as unknown as SandboxClientConfig).clientConfig?.baseOptions
      ?.headers ?? {}

  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  )
}

async function toolboxErrorMessage(response: Response, fallback: string) {
  const text = await response.text().catch(() => "")
  if (!text) return fallback

  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error
    }
  } catch {
    // Plain text toolbox errors are still useful.
  }

  return text.trim() || fallback
}

function invalidateTerminalCaches(sandboxId: string) {
  terminalSandboxCache.delete(sandboxId)
  terminalContextCache.delete(sandboxId)
}

function getTerminalSandbox(sandboxId: string) {
  const now = Date.now()
  const cached = terminalSandboxCache.get(sandboxId)
  if (cached && cached.expiresAt > now) return cached.promise
  if (cached) terminalSandboxCache.delete(sandboxId)

  const promise = getStartedDaytonaSandbox(sandboxId)
  terminalSandboxCache.set(sandboxId, {
    expiresAt: now + TERMINAL_CONTEXT_CACHE_TTL_MS,
    promise,
  })

  promise.catch(() => {
    if (terminalSandboxCache.get(sandboxId)?.promise === promise) {
      terminalSandboxCache.delete(sandboxId)
    }
  })

  return promise
}

function getTerminalContext(sandboxId: string) {
  const now = Date.now()
  const cached = terminalContextCache.get(sandboxId)
  if (cached && cached.expiresAt > now) return cached.promise
  if (cached) terminalContextCache.delete(sandboxId)

  const promise = (async () => {
    const sandbox = await getTerminalSandbox(sandboxId)
    const paths = await resolveDaytonaPaths(sandbox)
    return { paths, sandbox }
  })()

  terminalContextCache.set(sandboxId, {
    expiresAt: now + TERMINAL_CONTEXT_CACHE_TTL_MS,
    promise,
  })

  promise.catch(() => {
    if (terminalContextCache.get(sandboxId)?.promise === promise) {
      terminalContextCache.delete(sandboxId)
    }
  })

  return promise
}

async function createPtySession({
  cols,
  cwd,
  envs,
  rows,
  sandbox,
  terminalId,
}: {
  cols: number
  cwd: string
  envs: Record<string, string>
  rows: number
  sandbox: Sandbox
  terminalId: string
}) {
  const response = await fetch(`${toolboxBasePath(sandbox)}/process/pty`, {
    body: JSON.stringify({
      cols,
      cwd,
      envs,
      id: terminalId,
      lazyStart: true,
      rows,
    }),
    cache: "no-store",
    headers: {
      ...toolboxHeaders(sandbox),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  })

  if (response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      sessionId?: unknown
    }
    return {
      created: true,
      sessionId:
        typeof data.sessionId === "string" && data.sessionId.trim()
          ? data.sessionId
          : terminalId,
    }
  }

  if (response.status === 409) {
    return {
      created: false,
      sessionId: terminalId,
    }
  }

  throw new Error(
    await toolboxErrorMessage(response, "Unable to create Daytona terminal.")
  )
}

function terminalWebSocketUrl({
  previewToken,
  sandbox,
  sessionId,
}: {
  previewToken: string
  sandbox: Sandbox
  sessionId: string
}) {
  const url = new URL(
    `${toolboxBasePath(sandbox).replace(/^http/, "ws")}/process/pty/${encodeURIComponent(
      sessionId
    )}/connect`
  )
  if (previewToken) {
    url.searchParams.set("DAYTONA_SANDBOX_AUTH_KEY", previewToken)
  }
  return url.toString()
}

export async function prepareDaytonaTerminalWebSocket({
  cols,
  rows,
  sandboxId,
  terminalId,
}: {
  cols?: number
  rows?: number
  sandboxId: string
  terminalId: string
}): Promise<DaytonaTerminalWebSocket> {
  const cleanId = cleanTerminalId(terminalId)
  const size = cleanTerminalDimensions({ cols, rows })
  const sandbox = await getTerminalSandbox(sandboxId)
  const previewTokenPromise = sandbox.getPreviewLink(1)
  const { paths } = await getTerminalContext(sandboxId)

  const envs = {
    CLICOLOR: "1",
    COLORTERM: "truecolor",
    CODEX_HOME: paths.codexHome,
    FORCE_COLOR: "1",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: daytonaTerminalPath(paths.home),
    TERM: "xterm-256color",
  }

  const terminalSession = await createPtySession({
    cols: size.cols,
    cwd: paths.repoPath,
    envs,
    rows: size.rows,
    sandbox,
    terminalId: cleanId,
  }).catch(async (error: unknown) => {
    const racedSession = await sandbox.process
      .getPtySessionInfo(cleanId)
      .catch(() => null)
    if (!racedSession) throw error

    void sandbox.process
      .resizePtySession(cleanId, size.cols, size.rows)
      .catch(() => undefined)

    return {
      created: false,
      sessionId: cleanId,
    }
  })

  if (!terminalSession.created) {
    void sandbox.process
      .resizePtySession(cleanId, size.cols, size.rows)
      .catch(() => undefined)
  }

  const previewToken = (await previewTokenPromise).token ?? ""
  return {
    protocol: `X-Daytona-SDK-Version~${daytonaSdkPackage.version}`,
    sessionId: terminalSession.sessionId,
    wsUrl: terminalWebSocketUrl({
      previewToken,
      sandbox,
      sessionId: terminalSession.sessionId,
    }),
  }
}

export async function refreshDaytonaTerminalWebSocketGitHubAuth({
  githubToken,
  githubTokenExpiresAt,
  githubUserEmail,
  githubUserName,
  githubUsername,
  repoUrl,
  sandboxId,
  terminalId,
}: {
  githubToken?: string
  githubTokenExpiresAt?: string
  githubUserEmail?: string
  githubUserName?: string
  githubUsername?: string | null
  repoUrl?: string
  sandboxId: string
  terminalId: string
}) {
  const cleanId = cleanTerminalId(terminalId)
  const { paths, sandbox } = await getTerminalContext(sandboxId)

  return await refreshDaytonaTerminalGitHubAuth({
    githubToken,
    githubTokenExpiresAt,
    githubUserEmail,
    githubUserName,
    githubUsername,
    paths,
    repoUrl,
    sandbox,
    sandboxId,
    terminalId: cleanId,
  })
}

export async function resizeDaytonaTerminalWebSocket({
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
  const { sandbox } = await getTerminalContext(sandboxId)
  const cleanId = cleanTerminalId(terminalId)
  const size = cleanTerminalDimensions({ cols, rows })

  try {
    await sandbox.process.resizePtySession(cleanId, size.cols, size.rows)
  } catch {
    invalidateTerminalCaches(sandboxId)
    const freshSandbox = await getStartedDaytonaSandbox(sandboxId)
    await freshSandbox.process.resizePtySession(cleanId, size.cols, size.rows)
  }
}
