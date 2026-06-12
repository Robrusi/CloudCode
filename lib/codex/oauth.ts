import { createHash, randomBytes } from "node:crypto"
import { createServer, type Server } from "node:http"

import { saveCodexOAuthTokens } from "@/lib/codex/auth"
import { codexOAuthClientId, codexOAuthIssuer } from "@/lib/codex/oauth-config"
import { escapeHtml } from "@/lib/shared/html-escape"

const DEFAULT_PORT = 1455
const FALLBACK_PORT = 1457
const LOGIN_SERVER_VERSION = "settings-return-v1"
const SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke"

type PendingLogin = {
  appOrigin: string
  codeVerifier: string
  convexToken: string
  profile?: string
  forceLogin?: boolean
  returnUrl: string
  state: string
  useAccountProfile?: boolean
}

type LoginServerState = {
  pending: Map<string, PendingLogin>
  port: number
  server: Server
  version: string
}

type HtmlDocumentOptions = {
  autoRedirect?: boolean
  returnUrl?: string
}

declare global {
  var __cloudcodeCodexLoginServer: LoginServerState | undefined
}

function base64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function createPkcePair() {
  const codeVerifier = base64Url(randomBytes(32))
  const codeChallenge = base64Url(
    createHash("sha256").update(codeVerifier).digest()
  )

  return { codeChallenge, codeVerifier }
}

function createState() {
  return base64Url(randomBytes(32))
}

function buildAuthorizeUrl({
  codeChallenge,
  forceLogin,
  port,
  state,
}: {
  codeChallenge: string
  forceLogin?: boolean
  port: number
  state: string
}) {
  const issuer = codexOAuthIssuer()
  const url = new URL("/oauth/authorize", issuer)

  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", codexOAuthClientId())
  url.searchParams.set("redirect_uri", `http://localhost:${port}/auth/callback`)
  url.searchParams.set("scope", SCOPE)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("id_token_add_organizations", "true")
  url.searchParams.set("codex_cli_simplified_flow", "true")
  url.searchParams.set("state", state)
  url.searchParams.set("originator", "codex_cli_rs")
  if (forceLogin) {
    url.searchParams.set("max_age", "0")
  }

  return url.toString()
}

function oauthErrorMessage(url: URL) {
  const error = url.searchParams.get("error")
  if (!error) return null

  const description = url.searchParams.get("error_description")

  return description
    ? `ChatGPT sign-in failed: ${description}`
    : `ChatGPT sign-in failed: ${error}`
}

async function exchangeCodeForTokens(
  login: PendingLogin,
  code: string,
  port: number
) {
  const tokenEndpoint = new URL("/oauth/token", codexOAuthIssuer())
  const body = new URLSearchParams({
    client_id: codexOAuthClientId(),
    code,
    code_verifier: login.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: `http://localhost:${port}/auth/callback`,
  })

  const response = await fetch(tokenEndpoint, {
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  })

  if (!response.ok) {
    throw new Error(`Token exchange failed with status ${response.status}.`)
  }

  const data = (await response.json()) as {
    access_token?: unknown
    id_token?: unknown
    refresh_token?: unknown
  }

  if (
    typeof data.access_token !== "string" ||
    typeof data.id_token !== "string" ||
    typeof data.refresh_token !== "string"
  ) {
    throw new Error(
      "Token exchange response did not include all Codex OAuth tokens."
    )
  }

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
  }
}

function htmlDocument(message: string, options: HtmlDocumentOptions = {}) {
  const returnUrl = options.returnUrl?.trim()
  const escapedReturnUrl = returnUrl ? escapeHtml(returnUrl) : undefined
  const scriptReturnUrl = returnUrl
    ? JSON.stringify(returnUrl).replace(/</g, "\\u003c")
    : undefined
  const refresh =
    options.autoRedirect && escapedReturnUrl
      ? `<meta http-equiv="refresh" content="1;url=${escapedReturnUrl}">`
      : ""
  const script =
    options.autoRedirect && scriptReturnUrl
      ? `<script>window.setTimeout(function(){window.location.assign(${scriptReturnUrl})},100)</script>`
      : ""
  const returnLink = escapedReturnUrl
    ? `<p><a href="${escapedReturnUrl}">Return to Cloudcode</a></p>`
    : ""

  return `<!doctype html><html><head><meta charset="utf-8">${refresh}<title>Cloudcode Auth</title></head><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><p>${escapeHtml(message)}</p>${returnLink}${script}</body></html>`
}

async function handleCallback(
  state: LoginServerState,
  requestUrl: string,
  respond: (
    message: string,
    status?: number,
    options?: HtmlDocumentOptions
  ) => void
) {
  const url = new URL(requestUrl, `http://localhost:${state.port}`)

  if (url.pathname !== "/auth/callback") {
    respond("Not found.", 404)
    return
  }

  const stateParam = url.searchParams.get("state")
  const pending = stateParam ? state.pending.get(stateParam) : undefined
  const returnOptions = pending ? { returnUrl: pending.returnUrl } : undefined
  const oauthError = oauthErrorMessage(url)
  if (oauthError) {
    if (stateParam) {
      state.pending.delete(stateParam)
    }
    respond(oauthError, 400, returnOptions)
    return
  }

  const code = url.searchParams.get("code")

  if (!code || !stateParam) {
    if (stateParam) {
      state.pending.delete(stateParam)
    }
    respond("Missing OAuth code or state.", 400, returnOptions)
    return
  }

  if (!pending) {
    respond("OAuth state did not match an active login.", 400)
    return
  }

  state.pending.delete(stateParam)

  try {
    const tokens = await exchangeCodeForTokens(pending, code, state.port)
    await saveCodexOAuthTokens({
      ...tokens,
      convexToken: pending.convexToken,
      profile: pending.profile,
      useAccountProfile: pending.useAccountProfile,
    })
    respond("Signed in with ChatGPT. Returning to Cloudcode...", 200, {
      autoRedirect: true,
      returnUrl: pending.returnUrl,
    })
  } catch (error) {
    respond(
      error instanceof Error ? error.message : "ChatGPT sign-in failed.",
      400,
      {
        returnUrl: pending.returnUrl,
      }
    )
  }
}

async function listen(port: number) {
  return new Promise<LoginServerState>((resolve, reject) => {
    const pending = new Map<string, PendingLogin>()
    let loginState: LoginServerState
    const server = createServer((request, response) => {
      void handleCallback(
        loginState,
        request.url ?? "/",
        (message, status = 200, options) => {
          response.statusCode = status
          response.setHeader("Content-Type", "text/html; charset=utf-8")
          response.setHeader("Connection", "close")
          response.end(htmlDocument(message, options))
        }
      )
    })
    loginState = {
      pending,
      port,
      server,
      version: LOGIN_SERVER_VERSION,
    }

    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject)
      resolve(loginState)
    })
  })
}

async function closeLoginServer(state: LoginServerState) {
  await new Promise<void>((resolve) => {
    try {
      state.server.close(() => resolve())
    } catch {
      resolve()
    }
  })
}

async function getLoginServer() {
  if (
    globalThis.__cloudcodeCodexLoginServer?.version === LOGIN_SERVER_VERSION
  ) {
    return globalThis.__cloudcodeCodexLoginServer
  }

  if (globalThis.__cloudcodeCodexLoginServer) {
    await closeLoginServer(globalThis.__cloudcodeCodexLoginServer)
    globalThis.__cloudcodeCodexLoginServer = undefined
  }

  try {
    globalThis.__cloudcodeCodexLoginServer = await listen(DEFAULT_PORT)
  } catch {
    globalThis.__cloudcodeCodexLoginServer = await listen(FALLBACK_PORT)
  }

  return globalThis.__cloudcodeCodexLoginServer
}

export async function createCodexLoginUrl({
  appOrigin,
  convexToken,
  forceLogin,
  profile,
  returnUrl,
  useAccountProfile,
}: {
  appOrigin: string
  convexToken: string
  forceLogin?: boolean
  profile?: string
  returnUrl?: string
  useAccountProfile?: boolean
}) {
  const server = await getLoginServer()
  const { codeChallenge, codeVerifier } = createPkcePair()
  const state = createState()

  server.pending.set(state, {
    appOrigin,
    codeVerifier,
    convexToken,
    forceLogin,
    profile,
    returnUrl: returnUrl ?? appOrigin,
    state,
    useAccountProfile,
  })

  return buildAuthorizeUrl({
    codeChallenge,
    forceLogin,
    port: server.port,
    state,
  })
}
