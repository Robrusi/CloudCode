import { api } from "@/convex/_generated/api"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import {
  buildMcpAuthorizationUrl,
  createMcpOauthState,
  createMcpPkcePair,
  discoverMcpAuthorizationServer,
  exchangeMcpOauthCode,
  registerMcpOauthClient,
  revokeMcpOauthToken,
} from "@/lib/mcp/oauth"
import type { McpOauthProvider } from "@/lib/mcp/oauth-providers"
import { decryptSecret, encryptSecret } from "@/lib/security/secret-crypto"
import { getWorkerSecret } from "@/lib/security/worker-secret"

const MCP_OAUTH_WORKER_SECRET_ERROR =
  "Set TRIGGER_WORKER_SECRET before using MCP OAuth connections."

export const MCP_OAUTH_PROVIDER_COOKIE = "cloudcode_mcp_oauth_provider"
export const MCP_OAUTH_STATE_COOKIE = "cloudcode_mcp_oauth_state"
export const MCP_OAUTH_VERIFIER_COOKIE = "cloudcode_mcp_oauth_verifier"
export const MCP_OAUTH_COOKIE_PATH = "/api/mcp/oauth"

export function mcpOauthRedirectUri(origin: string) {
  return new URL("/api/mcp/oauth/callback", origin).toString()
}

async function getStoredConnection(provider: McpOauthProvider) {
  const client = await currentUserConvexHttpClient()
  return await client.query(api.mcpOauthConnections.getForServer, {
    provider: provider.id,
    workerSecret: getWorkerSecret(MCP_OAUTH_WORKER_SECRET_ERROR),
  })
}

export type McpSuppliedOauthClient = {
  clientId: string
  clientSecret: string
}

function envClientCredentials(provider: McpOauthProvider) {
  if (!provider.staticClientEnv) return null
  const { clientIdVar, clientSecretVar } = provider.staticClientEnv
  const clientId = process.env[clientIdVar]?.trim()
  const clientSecret = process.env[clientSecretVar]?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

async function storedClientCredentials(provider: McpOauthProvider) {
  const connection = await getStoredConnection(provider).catch(() => null)
  if (!connection?.clientId || !connection.encryptedClientSecret) return null
  return {
    clientId: connection.clientId,
    clientSecret: decryptSecret(connection.encryptedClientSecret),
  }
}

/**
 * Static-client providers (no dynamic registration) resolve credentials in
 * priority order: pasted in the setup dialog, deployment env vars, then the
 * registration already stored from a previous connect so reconnecting stays
 * one click.
 */
async function resolveOauthClient(
  provider: McpOauthProvider,
  registrationEndpoint: string | undefined,
  redirectUri: string,
  suppliedClient?: McpSuppliedOauthClient
) {
  if (suppliedClient) return suppliedClient

  if (provider.staticClientEnv) {
    const client =
      envClientCredentials(provider) ??
      (await storedClientCredentials(provider))
    if (client) return client
    throw new Error(
      `${provider.name} needs a one-time OAuth app. Open ${provider.name} in Settings → Integrations and enter the app's client ID and client secret.`
    )
  }

  if (!registrationEndpoint) {
    throw new Error(
      `${provider.name} does not support automatic client registration.`
    )
  }

  // Register a fresh client on every connect attempt so stale or expired
  // registrations can never strand the user in an unrecoverable state.
  return await registerMcpOauthClient({
    redirectUri,
    registrationEndpoint,
  })
}

/**
 * Static-client providers that cannot connect one-click yet: no pasted setup
 * stored for this user and no deployment env credentials.
 */
export async function listMcpProvidersNeedingSetup(
  providers: McpOauthProvider[]
) {
  const needingSetup: string[] = []
  for (const provider of providers) {
    if (!provider.staticClientEnv) continue
    if (envClientCredentials(provider)) continue
    if (await storedClientCredentials(provider)) continue
    needingSetup.push(provider.id)
  }
  return needingSetup
}

export async function startMcpOauthConnection({
  provider,
  redirectUri,
  suppliedClient,
}: {
  provider: McpOauthProvider
  redirectUri: string
  suppliedClient?: McpSuppliedOauthClient
}) {
  const metadata = await discoverMcpAuthorizationServer(provider.url)
  const registered = await resolveOauthClient(
    provider,
    metadata.registrationEndpoint,
    redirectUri,
    suppliedClient
  )

  const client = await currentUserConvexHttpClient()
  await client.mutation(api.mcpOauthConnections.saveClientRegistration, {
    authorizationEndpoint: metadata.authorizationEndpoint,
    clientId: registered.clientId,
    encryptedClientSecret: registered.clientSecret
      ? encryptSecret(registered.clientSecret)
      : undefined,
    provider: provider.id,
    revocationEndpoint: metadata.revocationEndpoint,
    serverUrl: provider.url,
    tokenEndpoint: metadata.tokenEndpoint,
    workerSecret: getWorkerSecret(MCP_OAUTH_WORKER_SECRET_ERROR),
  })

  const state = createMcpOauthState()
  const pkce = createMcpPkcePair()

  return {
    authorizationUrl: buildMcpAuthorizationUrl({
      authorizationEndpoint: metadata.authorizationEndpoint,
      clientId: registered.clientId,
      codeChallenge: pkce.challenge,
      redirectUri,
      resource: provider.url,
      scope: metadata.scope,
      state,
    }),
    state,
    verifier: pkce.verifier,
  }
}

export async function completeMcpOauthConnection({
  code,
  codeVerifier,
  provider,
  redirectUri,
}: {
  code: string
  codeVerifier: string
  provider: McpOauthProvider
  redirectUri: string
}) {
  const connection = await getStoredConnection(provider)
  if (!connection) {
    throw new Error(
      `The ${provider.name} authorization expired. Start the connection again.`
    )
  }

  const tokens = await exchangeMcpOauthCode({
    clientId: connection.clientId,
    clientSecretAuthMethod: provider.clientSecretAuthMethod,
    clientSecret: connection.encryptedClientSecret
      ? decryptSecret(connection.encryptedClientSecret)
      : undefined,
    code,
    codeVerifier,
    redirectUri,
    resource: connection.serverUrl,
    tokenEndpoint: connection.tokenEndpoint,
  })

  const client = await currentUserConvexHttpClient()
  return await client.mutation(api.mcpOauthConnections.completeAuthorization, {
    encryptedAccessToken: encryptSecret(tokens.accessToken),
    encryptedRefreshToken: tokens.refreshToken
      ? encryptSecret(tokens.refreshToken)
      : undefined,
    expiresAt: tokens.expiresAt,
    provider: provider.id,
    scope: tokens.scope,
    serverDisplayName: provider.name,
    workerSecret: getWorkerSecret(MCP_OAUTH_WORKER_SECRET_ERROR),
  })
}

export async function disconnectMcpOauthConnection(provider: McpOauthProvider) {
  const connection = await getStoredConnection(provider).catch(() => null)
  let revokeError: string | undefined

  if (connection?.revocationEndpoint && connection.encryptedAccessToken) {
    const clientSecret = connection.encryptedClientSecret
      ? decryptSecret(connection.encryptedClientSecret)
      : undefined
    const tokens = [
      connection.encryptedRefreshToken
        ? decryptSecret(connection.encryptedRefreshToken)
        : undefined,
      decryptSecret(connection.encryptedAccessToken),
    ].filter((token): token is string => Boolean(token))

    for (const token of tokens) {
      try {
        await revokeMcpOauthToken({
          clientId: connection.clientId,
          clientSecretAuthMethod: provider.clientSecretAuthMethod,
          clientSecret,
          revocationEndpoint: connection.revocationEndpoint,
          token,
        })
      } catch (error) {
        revokeError =
          error instanceof Error
            ? error.message
            : "Unable to revoke the authorization."
      }
    }
  }

  const client = await currentUserConvexHttpClient()
  const result = await client.mutation(api.mcpOauthConnections.disconnect, {
    provider: provider.id,
  })

  return { ...result, revokeError }
}
