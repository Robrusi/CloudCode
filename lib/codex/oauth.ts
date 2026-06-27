import { createHash, randomBytes } from "node:crypto"
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"

import { saveCodexOAuthTokens } from "@/lib/codex/auth"
import { codexOAuthClientId, codexOAuthIssuer } from "@/lib/codex/oauth-config"
import { escapeHtml } from "@/lib/shared/html-escape"

const CODEX_OAUTH_CALLBACK_PORTS = [1455, 1457] as const
const CODEX_OAUTH_CALLBACK_PATH = "/auth/callback"
const CODEX_OAUTH_PENDING_TTL_MS = 15 * 60 * 1000
const CODEX_OAUTH_IDLE_CLOSE_MS = 60 * 1000
const CODEX_OAUTH_ORIGINATOR =
  process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE ?? "codex_cli_rs"
const CODEX_OAUTH_SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke"

type CodexOAuthTokens = {
  accessToken: string
  idToken: string
  refreshToken: string
}

type PendingCodexOAuthLogin = {
  appOrigin: string
  codeVerifier: string
  convexToken: string
  expiresAt: number
  timeout: ReturnType<typeof setTimeout>
}

type CodexOAuthCallbackServerState = {
  closeTimer: ReturnType<typeof setTimeout> | null
  pending: Map<string, PendingCodexOAuthLogin>
  port: number
  server: Server
}

const globalCodexOAuthState = globalThis as typeof globalThis & {
  __cloudcodeCodexOAuthCallbackServer?: CodexOAuthCallbackServerState
}

function base64UrlRandom(byteLength: number) {
  return randomBytes(byteLength).toString("base64url")
}

function callbackRedirectUri(port: number) {
  return `http://localhost:${port}${CODEX_OAUTH_CALLBACK_PATH}`
}

function createPkce() {
  const codeVerifier = base64UrlRandom(64)
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url")

  return { codeChallenge, codeVerifier }
}

function createState() {
  return base64UrlRandom(32)
}

function buildCodexOAuthAuthorizeUrl({
  codeChallenge,
  redirectUri,
  state,
}: {
  codeChallenge: string
  redirectUri: string
  state: string
}) {
  const issuer = codexOAuthIssuer().replace(/\/+$/, "")
  const url = new URL(`${issuer}/oauth/authorize`)

  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", codexOAuthClientId())
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("scope", CODEX_OAUTH_SCOPE)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("id_token_add_organizations", "true")
  url.searchParams.set("codex_cli_simplified_flow", "true")
  url.searchParams.set("state", state)
  url.searchParams.set("originator", CODEX_OAUTH_ORIGINATOR)

  return url.toString()
}

function tokenErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback
  const record = data as Record<string, unknown>
  const parts = [record.error, record.error_description, record.message].filter(
    (value): value is string => typeof value === "string" && value.trim() !== ""
  )

  return parts.length > 0 ? parts.join(": ") : fallback
}

async function exchangeCodexOAuthCode({
  code,
  codeVerifier,
  redirectUri,
}: {
  code: string
  codeVerifier: string
  redirectUri: string
}): Promise<CodexOAuthTokens> {
  const issuer = codexOAuthIssuer().replace(/\/+$/, "")
  const body = new URLSearchParams({
    client_id: codexOAuthClientId(),
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  })

  const response = await fetch(`${issuer}/oauth/token`, {
    body,
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  })
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: unknown
    error?: unknown
    error_description?: unknown
    id_token?: unknown
    message?: unknown
    refresh_token?: unknown
  }

  if (!response.ok) {
    throw new Error(
      tokenErrorMessage(
        data,
        `ChatGPT token exchange failed with status ${response.status}.`
      )
    )
  }

  if (
    typeof data.access_token !== "string" ||
    typeof data.id_token !== "string" ||
    typeof data.refresh_token !== "string"
  ) {
    throw new Error("ChatGPT token exchange response was missing tokens.")
  }

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
  }
}

function writeHtml(
  response: ServerResponse,
  {
    message,
    status,
    title,
  }: {
    message: string
    status: number
    title: string
  }
) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
  })
  response.end(
    `<!doctype html><meta charset="utf-8"><title>Cloudcode Auth</title><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><h1 style="font-size:1.25rem">${escapeHtml(
      title
    )}</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to Cloudcode</a></p></body>`
  )
}

function redirect(response: ServerResponse, location: string) {
  response.writeHead(302, {
    location,
  })
  response.end()
}

function scheduleCloseIfIdle(state: CodexOAuthCallbackServerState) {
  if (state.pending.size > 0 || state.closeTimer) return

  state.closeTimer = setTimeout(() => {
    if (state.pending.size > 0) {
      state.closeTimer = null
      return
    }

    state.server.close(() => {
      if (globalCodexOAuthState.__cloudcodeCodexOAuthCallbackServer === state) {
        globalCodexOAuthState.__cloudcodeCodexOAuthCallbackServer = undefined
      }
    })
  }, CODEX_OAUTH_IDLE_CLOSE_MS)
  state.closeTimer.unref()
}

function deletePendingLogin(
  state: CodexOAuthCallbackServerState,
  oauthState: string
) {
  const pending = state.pending.get(oauthState)
  if (!pending) return null

  clearTimeout(pending.timeout)
  state.pending.delete(oauthState)
  scheduleCloseIfIdle(state)
  return pending
}

async function handleCallback(
  state: CodexOAuthCallbackServerState,
  request: IncomingMessage,
  response: ServerResponse
) {
  const requestUrl = new URL(
    request.url ?? "/",
    `http://localhost:${state.port}`
  )

  if (requestUrl.pathname !== CODEX_OAUTH_CALLBACK_PATH) {
    writeHtml(response, {
      message: "This callback listener only handles ChatGPT sign-in.",
      status: 404,
      title: "Cloudcode auth route not found",
    })
    return
  }

  const returnedState = requestUrl.searchParams.get("state") ?? ""
  const pending = returnedState
    ? deletePendingLogin(state, returnedState)
    : null

  if (!pending || pending.expiresAt < Date.now()) {
    writeHtml(response, {
      message: "The ChatGPT sign-in session expired. Start sign-in again.",
      status: 400,
      title: "ChatGPT sign-in failed",
    })
    return
  }

  const oauthError = requestUrl.searchParams.get("error")
  if (oauthError) {
    writeHtml(response, {
      message:
        requestUrl.searchParams.get("error_description") ??
        `ChatGPT returned ${oauthError}.`,
      status: 400,
      title: "ChatGPT sign-in failed",
    })
    return
  }

  const code = requestUrl.searchParams.get("code")
  if (!code) {
    writeHtml(response, {
      message: "ChatGPT did not return an authorization code.",
      status: 400,
      title: "ChatGPT sign-in failed",
    })
    return
  }

  try {
    const tokens = await exchangeCodexOAuthCode({
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri: callbackRedirectUri(state.port),
    })

    await saveCodexOAuthTokens({
      ...tokens,
      convexToken: pending.convexToken,
      useAccountProfile: true,
    })

    redirect(response, new URL("/?view=settings", pending.appOrigin).toString())
  } catch (error) {
    writeHtml(response, {
      message:
        error instanceof Error
          ? error.message
          : "Unable to complete ChatGPT sign-in.",
      status: 400,
      title: "ChatGPT sign-in failed",
    })
  }
}

function createCallbackServerState(port: number) {
  const pending = new Map<string, PendingCodexOAuthLogin>()
  let state: CodexOAuthCallbackServerState
  const server = createServer((request, response) => {
    void handleCallback(state, request, response).catch((error) => {
      writeHtml(response, {
        message:
          error instanceof Error
            ? error.message
            : "Unable to complete ChatGPT sign-in.",
        status: 500,
        title: "ChatGPT sign-in failed",
      })
    })
  })
  state = {
    closeTimer: null,
    pending,
    port,
    server,
  }

  return state
}

async function listenOnPort(port: number) {
  const state = createCallbackServerState(port)

  await new Promise<void>((resolve, reject) => {
    function onError(error: Error) {
      reject(error)
    }

    state.server.once("error", onError)
    state.server.listen(port, "127.0.0.1", () => {
      state.server.off("error", onError)
      state.server.unref()
      resolve()
    })
  })

  return state
}

async function ensureCallbackServer() {
  const existing = globalCodexOAuthState.__cloudcodeCodexOAuthCallbackServer
  if (existing?.server.listening) {
    if (existing.closeTimer) {
      clearTimeout(existing.closeTimer)
      existing.closeTimer = null
    }
    return existing
  }

  let lastError: unknown
  for (const port of CODEX_OAUTH_CALLBACK_PORTS) {
    try {
      const state = await listenOnPort(port)
      globalCodexOAuthState.__cloudcodeCodexOAuthCallbackServer = state
      return state
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `Unable to start local ChatGPT callback listener: ${lastError.message}`
      : "Unable to start local ChatGPT callback listener."
  )
}

export async function createCodexOAuthLoginUrl({
  appOrigin,
  convexToken,
}: {
  appOrigin: string
  convexToken: string
}) {
  const callbackServer = await ensureCallbackServer()
  const { codeChallenge, codeVerifier } = createPkce()
  const state = createState()
  const timeout = setTimeout(() => {
    callbackServer.pending.delete(state)
    scheduleCloseIfIdle(callbackServer)
  }, CODEX_OAUTH_PENDING_TTL_MS)
  timeout.unref()

  callbackServer.pending.set(state, {
    appOrigin,
    codeVerifier,
    convexToken,
    expiresAt: Date.now() + CODEX_OAUTH_PENDING_TTL_MS,
    timeout,
  })

  return buildCodexOAuthAuthorizeUrl({
    codeChallenge,
    redirectUri: callbackRedirectUri(callbackServer.port),
    state,
  })
}
