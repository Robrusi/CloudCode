import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"
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
const CODEX_DEVICE_AUTH_TTL_MS = 15 * 60 * 1000

export const CODEX_DEVICE_AUTH_COOKIE = "cloudcode_codex_device_auth"
export const CODEX_DEVICE_AUTH_COOKIE_PATH = "/api/codex-auth"

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

export type CodexDeviceLoginSession = {
  deviceAuthId: string
  expiresAt: number
  intervalSeconds: number
  userCode: string
  verificationUrl: string
}

type CodexDeviceTokenResponse = {
  authorizationCode: string
  codeVerifier: string
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

function issuerBaseUrl() {
  return codexOAuthIssuer().replace(/\/+$/, "")
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
  const issuer = issuerBaseUrl()
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
  const issuer = issuerBaseUrl()
  const body = new URLSearchParams({
    client_id: codexOAuthClientId(),
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  })
  const clientSecret = process.env.OPENAI_CODEX_CLIENT_SECRET
  if (clientSecret) {
    body.set("client_secret", clientSecret)
  }

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

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}

  try {
    return JSON.parse(text) as unknown
  } catch {
    return { message: text }
  }
}

function authWindowCookieSecret() {
  const secret =
    process.env.CODEX_OAUTH_COOKIE_SECRET ??
    process.env.CLERK_SECRET_KEY ??
    process.env.TRIGGER_WORKER_SECRET ??
    process.env.SECRET_ENCRYPTION_KEY ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET

  if (!secret) {
    throw new Error(
      "Set CODEX_OAUTH_COOKIE_SECRET or CLERK_SECRET_KEY before using hosted ChatGPT device sign-in."
    )
  }

  return secret
}

function signAuthWindowCookiePayload(payload: string) {
  return createHmac("sha256", authWindowCookieSecret())
    .update(payload)
    .digest("base64url")
}

function signaturesMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

export function encodeCodexDeviceLoginSession(
  session: CodexDeviceLoginSession
) {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString(
    "base64url"
  )
  const signature = signAuthWindowCookiePayload(payload)

  return `${payload}.${signature}`
}

export function decodeCodexDeviceLoginSession(value?: string) {
  if (!value) return null
  const [payload, signature, ...extraParts] = value.split(".")

  if (!payload || !signature || extraParts.length > 0) return null
  if (!signaturesMatch(signature, signAuthWindowCookiePayload(payload))) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object") return null
  const record = parsed as Record<string, unknown>
  const deviceAuthId = optionalString(record.deviceAuthId)
  const userCode = optionalString(record.userCode)
  const verificationUrl = optionalString(record.verificationUrl)
  const expiresAt =
    typeof record.expiresAt === "number" && Number.isFinite(record.expiresAt)
      ? record.expiresAt
      : undefined
  const intervalSeconds =
    typeof record.intervalSeconds === "number" &&
    Number.isFinite(record.intervalSeconds) &&
    record.intervalSeconds > 0
      ? record.intervalSeconds
      : 5

  if (!deviceAuthId || !userCode || !verificationUrl || !expiresAt) {
    return null
  }

  return {
    deviceAuthId,
    expiresAt,
    intervalSeconds,
    userCode,
    verificationUrl,
  } satisfies CodexDeviceLoginSession
}

function deviceAuthErrorMessage(data: unknown, fallback: string) {
  return tokenErrorMessage(data, fallback)
}

async function requestCodexDeviceCode(): Promise<CodexDeviceLoginSession> {
  const issuer = issuerBaseUrl()
  const response = await fetch(`${issuer}/api/accounts/deviceauth/usercode`, {
    body: JSON.stringify({
      client_id: codexOAuthClientId(),
    }),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  const data = await readJsonResponse(response)

  if (!response.ok) {
    throw new Error(
      deviceAuthErrorMessage(
        data,
        `ChatGPT device sign-in could not start (${response.status}).`
      )
    )
  }

  if (!data || typeof data !== "object") {
    throw new Error("ChatGPT device sign-in response was malformed.")
  }

  const record = data as Record<string, unknown>
  const deviceAuthId = optionalString(record.device_auth_id)
  const userCode =
    optionalString(record.user_code) ?? optionalString(record.usercode)
  const interval =
    typeof record.interval === "number"
      ? record.interval
      : typeof record.interval === "string"
        ? Number.parseInt(record.interval, 10)
        : 5

  if (!deviceAuthId || !userCode) {
    throw new Error("ChatGPT device sign-in response was missing a code.")
  }

  return {
    deviceAuthId,
    expiresAt: Date.now() + CODEX_DEVICE_AUTH_TTL_MS,
    intervalSeconds: Number.isFinite(interval) && interval > 0 ? interval : 5,
    userCode,
    verificationUrl: `${issuer}/codex/device`,
  }
}

async function pollCodexDeviceCode({
  deviceAuthId,
  userCode,
}: Pick<CodexDeviceLoginSession, "deviceAuthId" | "userCode">): Promise<
  | { status: "complete"; token: CodexDeviceTokenResponse }
  | { status: "pending" }
> {
  const issuer = issuerBaseUrl()
  const response = await fetch(`${issuer}/api/accounts/deviceauth/token`, {
    body: JSON.stringify({
      device_auth_id: deviceAuthId,
      user_code: userCode,
    }),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  const data = await readJsonResponse(response)

  if (response.status === 403 || response.status === 404) {
    return { status: "pending" }
  }

  if (!response.ok) {
    throw new Error(
      deviceAuthErrorMessage(
        data,
        `ChatGPT device sign-in failed (${response.status}).`
      )
    )
  }

  if (!data || typeof data !== "object") {
    throw new Error("ChatGPT device token response was malformed.")
  }

  const record = data as Record<string, unknown>
  const authorizationCode = optionalString(record.authorization_code)
  const codeVerifier = optionalString(record.code_verifier)

  if (!authorizationCode || !codeVerifier) {
    throw new Error("ChatGPT device token response was missing its code.")
  }

  return {
    status: "complete",
    token: {
      authorizationCode,
      codeVerifier,
    },
  }
}

export async function createCodexDeviceLoginSession() {
  return await requestCodexDeviceCode()
}

export async function completeCodexDeviceLogin({
  convexToken,
  session,
}: {
  convexToken: string
  session: CodexDeviceLoginSession
}) {
  if (session.expiresAt < Date.now()) {
    throw new Error("ChatGPT device sign-in expired. Start sign-in again.")
  }

  const poll = await pollCodexDeviceCode(session)
  if (poll.status === "pending") {
    return {
      retryAfterMs: session.intervalSeconds * 1000,
      status: "pending" as const,
    }
  }

  const tokens = await exchangeCodexOAuthCode({
    code: poll.token.authorizationCode,
    codeVerifier: poll.token.codeVerifier,
    redirectUri: `${issuerBaseUrl()}/deviceauth/callback`,
  })

  await saveCodexOAuthTokens({
    ...tokens,
    convexToken,
    useAccountProfile: true,
  })

  return { status: "complete" as const }
}

export function codexAuthWindowHtml({
  error,
  message,
  status,
  targetOrigin,
  title,
}: {
  error?: string
  message: string
  status: "complete" | "error"
  targetOrigin: string
  title: string
}) {
  const serializedMessage = JSON.stringify({
    error: error ?? (status === "error" ? message : undefined),
    status,
    type: "cloudcode:codex-auth",
  })
  const serializedTargetOrigin = JSON.stringify(targetOrigin)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        align-items: center;
        background: #0d1117;
        color: #f0f6fc;
        display: flex;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
      }
      main {
        max-width: 28rem;
        padding: 2rem;
        text-align: center;
      }
      h1 {
        font-size: 1.125rem;
        margin: 0 0 0.75rem;
      }
      p {
        color: #c9d1d9;
        line-height: 1.5;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
    <script>
      const message = ${serializedMessage};
      const targetOrigin = ${serializedTargetOrigin};
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(message, targetOrigin);
      }
      window.close();
    </script>
  </body>
</html>`
}

function writeHtml(
  response: ServerResponse,
  {
    appOrigin,
    message,
    status,
    title,
  }: {
    appOrigin?: string
    message: string
    status: number
    title: string
  }
) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
  })
  response.end(
    codexAuthWindowHtml({
      error: status >= 400 ? message : undefined,
      message,
      status: status >= 400 ? "error" : "complete",
      targetOrigin: appOrigin ?? "*",
      title,
    })
  )
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
      appOrigin: pending.appOrigin,
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
      appOrigin: pending.appOrigin,
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

    writeHtml(response, {
      appOrigin: pending.appOrigin,
      message: "ChatGPT is connected. You can close this window.",
      status: 200,
      title: "ChatGPT connected",
    })
  } catch (error) {
    writeHtml(response, {
      appOrigin: pending.appOrigin,
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
