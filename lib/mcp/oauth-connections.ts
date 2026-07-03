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

function staticClientCredentials(
  provider: McpOauthProvider,
  redirectUri: string
) {
  if (!provider.staticClientEnv) return null
  const { clientIdVar, clientSecretVar } = provider.staticClientEnv
  const clientId = process.env[clientIdVar]?.trim()
  const clientSecret = process.env[clientSecretVar]?.trim()

  if (!clientId || !clientSecret) {
    throw new Error(
      `${provider.name} does not support automatic client registration. Create an OAuth app in ${provider.name} with redirect URL ${redirectUri}, then set ${clientIdVar} and ${clientSecretVar}.`
    )
  }

  return { clientId, clientSecret }
}

async function resolveOauthClient(
  provider: McpOauthProvider,
  registrationEndpoint: string | undefined,
  redirectUri: string
) {
  const staticClient = staticClientCredentials(provider, redirectUri)
  if (staticClient) return staticClient

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

export async function startMcpOauthConnection({
  provider,
  redirectUri,
}: {
  provider: McpOauthProvider
  redirectUri: string
}) {
  const metadata = await discoverMcpAuthorizationServer(provider.url)
  const registered = await resolveOauthClient(
    provider,
    metadata.registrationEndpoint,
    redirectUri
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
