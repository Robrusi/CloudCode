import { createHash, randomBytes } from "node:crypto"

import type { McpClientSecretAuthMethod } from "@/lib/mcp/oauth-providers"
import { stringValue as optionalString } from "@/lib/shared/unknown-values"

// Generic MCP authorization (OAuth 2.1) client: RFC 9728 protected resource
// metadata discovery, RFC 8414 authorization server metadata, RFC 7591
// dynamic client registration, and PKCE code + refresh token exchange.

const DISCOVERY_TIMEOUT_MS = 10_000
const TOKEN_TIMEOUT_MS = 15_000

export type McpAuthorizationServer = {
  authorizationEndpoint: string
  registrationEndpoint?: string
  revocationEndpoint?: string
  scope?: string
  tokenEndpoint: string
}

export type McpOauthTokens = {
  accessToken: string
  expiresAt?: number
  refreshToken?: string
  scope?: string
}

function requireHttpsUrl(value: string, label: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} is not a valid URL.`)
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} must use http or https.`)
  }
  return url
}

async function fetchJsonIfOk(url: string) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return (await response.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

function wellKnownCandidates(url: URL, suffix: string) {
  const path = url.pathname.replace(/\/$/, "")
  const candidates = [`${url.origin}/.well-known/${suffix}`]
  if (path && path !== "/") {
    candidates.unshift(`${url.origin}/.well-known/${suffix}${path}`)
  }
  return candidates
}

async function probeResourceMetadataUrl(serverUrl: URL) {
  try {
    const response = await fetch(serverUrl, {
      headers: { accept: "application/json, text/event-stream" },
      redirect: "manual",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    })
    await response.body?.cancel().catch(() => undefined)
    const challenge = response.headers.get("www-authenticate")
    const match = challenge?.match(/resource_metadata="([^"]+)"/i)
    return match?.[1]
  } catch {
    return undefined
  }
}

async function fetchProtectedResourceMetadata(serverUrl: URL) {
  const advertised = await probeResourceMetadataUrl(serverUrl)
  const candidates = [
    ...(advertised ? [advertised] : []),
    ...wellKnownCandidates(serverUrl, "oauth-protected-resource"),
  ]

  for (const candidate of candidates) {
    const metadata = await fetchJsonIfOk(candidate)
    if (!metadata) continue
    const servers = Array.isArray(metadata.authorization_servers)
      ? metadata.authorization_servers.filter(
          (server): server is string => typeof server === "string"
        )
      : []
    if (servers.length) {
      return {
        authorizationServer: servers[0],
        scope: Array.isArray(metadata.scopes_supported)
          ? metadata.scopes_supported
              .filter((scope): scope is string => typeof scope === "string")
              .join(" ") || undefined
          : undefined,
      }
    }
  }

  return null
}

function parseAuthorizationServerMetadata(
  metadata: Record<string, unknown>,
  scope: string | undefined
): McpAuthorizationServer | null {
  const authorizationEndpoint = optionalString(metadata.authorization_endpoint)
  const tokenEndpoint = optionalString(metadata.token_endpoint)
  if (!authorizationEndpoint || !tokenEndpoint) return null

  return {
    authorizationEndpoint,
    registrationEndpoint: optionalString(metadata.registration_endpoint),
    revocationEndpoint: optionalString(metadata.revocation_endpoint),
    scope,
    tokenEndpoint,
  }
}

export async function discoverMcpAuthorizationServer(
  serverUrlInput: string
): Promise<McpAuthorizationServer> {
  const serverUrl = requireHttpsUrl(serverUrlInput, "MCP server URL")
  const resourceMetadata = await fetchProtectedResourceMetadata(serverUrl)
  // Legacy MCP servers act as their own authorization server and expose the
  // metadata directly on their origin.
  const issuer = requireHttpsUrl(
    resourceMetadata?.authorizationServer ?? serverUrl.origin,
    "Authorization server URL"
  )

  const candidates = [
    ...wellKnownCandidates(issuer, "oauth-authorization-server"),
    ...wellKnownCandidates(issuer, "openid-configuration"),
  ]

  for (const candidate of candidates) {
    const metadata = await fetchJsonIfOk(candidate)
    if (!metadata) continue
    const parsed = parseAuthorizationServerMetadata(
      metadata,
      resourceMetadata?.scope
    )
    if (parsed) return parsed
  }

  throw new Error(
    "This MCP server does not advertise OAuth authorization metadata."
  )
}

export async function registerMcpOauthClient({
  redirectUri,
  registrationEndpoint,
}: {
  redirectUri: string
  registrationEndpoint: string
}) {
  const response = await fetch(registrationEndpoint, {
    body: JSON.stringify({
      client_name: "Cloudcode",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [redirectUri],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  })
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >

  const clientId = optionalString(data.client_id)
  if (!response.ok || !clientId) {
    throw new Error(
      optionalString(data.error_description) ??
        "The MCP authorization server rejected client registration."
    )
  }

  return {
    clientId,
    clientSecret: optionalString(data.client_secret),
  }
}

export function createMcpOauthState() {
  return randomBytes(24).toString("base64url")
}

export function createMcpPkcePair() {
  const verifier = randomBytes(48).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { challenge, verifier }
}

export function buildMcpAuthorizationUrl({
  authorizationEndpoint,
  clientId,
  codeChallenge,
  redirectUri,
  resource,
  scope,
  state,
}: {
  authorizationEndpoint: string
  clientId: string
  codeChallenge: string
  redirectUri: string
  resource: string
  scope?: string
  state: string
}) {
  const url = requireHttpsUrl(authorizationEndpoint, "Authorization endpoint")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("resource", resource)
  if (scope) url.searchParams.set("scope", scope)
  return url.toString()
}

async function requestMcpOauthTokens({
  body,
  clientId,
  clientSecretAuthMethod = "client_secret_basic",
  clientSecret,
  tokenEndpoint,
}: {
  body: URLSearchParams
  clientId: string
  clientSecretAuthMethod?: McpClientSecretAuthMethod
  clientSecret?: string
  tokenEndpoint: string
}): Promise<McpOauthTokens> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  }
  if (clientSecret) {
    if (clientSecretAuthMethod === "client_secret_post") {
      body.set("client_id", clientId)
      body.set("client_secret", clientSecret)
    } else {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString(
        "base64"
      )
      headers.authorization = `Basic ${basic}`
    }
  } else {
    body.set("client_id", clientId)
  }

  const response = await fetch(tokenEndpoint, {
    body: body.toString(),
    headers,
    method: "POST",
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  })
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >

  const accessToken = optionalString(data.access_token)
  if (!response.ok || !accessToken) {
    throw new Error(
      optionalString(data.error_description) ??
        optionalString(data.error) ??
        "The MCP authorization server rejected the token request."
    )
  }

  const expiresIn =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in)
      ? data.expires_in
      : undefined

  return {
    accessToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    refreshToken: optionalString(data.refresh_token),
    scope: optionalString(data.scope),
  }
}

export async function exchangeMcpOauthCode({
  clientId,
  clientSecretAuthMethod,
  clientSecret,
  code,
  codeVerifier,
  redirectUri,
  resource,
  tokenEndpoint,
}: {
  clientId: string
  clientSecretAuthMethod?: McpClientSecretAuthMethod
  clientSecret?: string
  code: string
  codeVerifier: string
  redirectUri: string
  resource: string
  tokenEndpoint: string
}) {
  return await requestMcpOauthTokens({
    body: new URLSearchParams({
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      resource,
    }),
    clientId,
    clientSecretAuthMethod,
    clientSecret,
    tokenEndpoint,
  })
}

export async function refreshMcpOauthToken({
  clientId,
  clientSecretAuthMethod,
  clientSecret,
  refreshToken,
  resource,
  tokenEndpoint,
}: {
  clientId: string
  clientSecretAuthMethod?: McpClientSecretAuthMethod
  clientSecret?: string
  refreshToken: string
  resource: string
  tokenEndpoint: string
}) {
  return await requestMcpOauthTokens({
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      resource,
    }),
    clientId,
    clientSecretAuthMethod,
    clientSecret,
    tokenEndpoint,
  })
}

export async function revokeMcpOauthToken({
  clientId,
  clientSecretAuthMethod = "client_secret_basic",
  clientSecret,
  revocationEndpoint,
  token,
}: {
  clientId: string
  clientSecretAuthMethod?: McpClientSecretAuthMethod
  clientSecret?: string
  revocationEndpoint: string
  token: string
}) {
  const body = new URLSearchParams({ token })
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  }
  if (clientSecret) {
    if (clientSecretAuthMethod === "client_secret_post") {
      body.set("client_id", clientId)
      body.set("client_secret", clientSecret)
    } else {
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString(
        "base64"
      )
      headers.authorization = `Basic ${basic}`
    }
  } else {
    body.set("client_id", clientId)
  }

  const response = await fetch(revocationEndpoint, {
    body: body.toString(),
    headers,
    method: "POST",
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Token revocation failed (${response.status}).`)
  }
}
