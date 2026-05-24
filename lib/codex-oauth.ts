import { createHash, randomBytes } from "node:crypto"
import { createServer, type Server } from "node:http"

import { saveCodexOAuthTokens } from "@/lib/codex-auth"
import { escapeHtml } from "@/lib/html-escape"

const DEFAULT_ISSUER = "https://auth.openai.com"
const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const DEFAULT_PORT = 1455
const FALLBACK_PORT = 1457
const SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke"

type PendingLogin = {
  appOrigin: string
  codeVerifier: string
  convexToken: string
  profile?: string
  state: string
}

type LoginServerState = {
  pending: Map<string, PendingLogin>
  port: number
  server: Server
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

function getClientId() {
  return process.env.OPENAI_CODEX_CLIENT_ID ?? DEFAULT_CLIENT_ID
}

function getIssuer() {
  return process.env.OPENAI_CODEX_ISSUER ?? DEFAULT_ISSUER
}

function buildAuthorizeUrl({
  codeChallenge,
  port,
  state,
}: {
  codeChallenge: string
  port: number
  state: string
}) {
  const issuer = getIssuer()
  const url = new URL("/oauth/authorize", issuer)

  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", getClientId())
  url.searchParams.set("redirect_uri", `http://localhost:${port}/auth/callback`)
  url.searchParams.set("scope", SCOPE)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("id_token_add_organizations", "true")
  url.searchParams.set("codex_cli_simplified_flow", "true")
  url.searchParams.set("state", state)
  url.searchParams.set("originator", "codex_cli_rs")

  return url.toString()
}

async function exchangeCodeForTokens(
  login: PendingLogin,
  code: string,
  port: number
) {
  const tokenEndpoint = new URL("/oauth/token", getIssuer())
  const body = new URLSearchParams({
    client_id: getClientId(),
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

function htmlDocument(message: string) {
  return `<!doctype html><meta charset="utf-8"><title>Cloudcode Auth</title><body style="font-family:system-ui;padding:2rem">${escapeHtml(message)}</body>`
}

async function handleCallback(
  state: LoginServerState,
  requestUrl: string,
  respond: (message: string, status?: number) => void
) {
  const url = new URL(requestUrl, `http://localhost:${state.port}`)

  if (url.pathname !== "/auth/callback") {
    respond("Not found.", 404)
    return
  }

  const code = url.searchParams.get("code")
  const stateParam = url.searchParams.get("state")

  if (!code || !stateParam) {
    respond("Missing OAuth code or state.", 400)
    return
  }

  const pending = state.pending.get(stateParam)

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
    })
    respond(
      "Signed in with ChatGPT. You can close this tab or return to Cloudcode."
    )
  } catch (error) {
    respond(
      error instanceof Error ? error.message : "ChatGPT sign-in failed.",
      400
    )
  }
}

async function listen(port: number) {
  return new Promise<LoginServerState>((resolve, reject) => {
    const pending = new Map<string, PendingLogin>()
    const server = createServer((request, response) => {
      void handleCallback(
        { pending, port, server },
        request.url ?? "/",
        (message, status = 200) => {
          response.statusCode = status
          response.setHeader("Content-Type", "text/html; charset=utf-8")
          response.setHeader("Connection", "close")
          response.end(htmlDocument(message))
        }
      )
    })

    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject)
      resolve({ pending, port, server })
    })
  })
}

async function getLoginServer() {
  if (globalThis.__cloudcodeCodexLoginServer) {
    return globalThis.__cloudcodeCodexLoginServer
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
  profile,
}: {
  appOrigin: string
  convexToken: string
  profile?: string
}) {
  const server = await getLoginServer()
  const { codeChallenge, codeVerifier } = createPkcePair()
  const state = createState()

  server.pending.set(state, {
    appOrigin,
    codeVerifier,
    convexToken,
    profile,
    state,
  })

  return buildAuthorizeUrl({
    codeChallenge,
    port: server.port,
    state,
  })
}
