import type { SlackInstallation } from "@chat-adapter/slack"

import { SLACK_MCP_USER_SCOPES } from "@/lib/integrations/mcp"

type SlackOauthUser = {
  access_token?: string
  expires_in?: number
  id?: string
  refresh_token?: string
  scope?: string
}

type SlackOauthResponse = {
  access_token?: string
  authed_user?: SlackOauthUser
  bot_user_id?: string
  error?: string
  expires_in?: number
  ok?: boolean
  refresh_token?: string
  team?: { id?: string; name?: string }
}

function scopesOf(value: string | undefined) {
  return [
    ...new Set(
      (value ?? "")
        .split(/[\s,]+/)
        .map((scope) => scope.trim())
        .filter(Boolean)
    ),
  ].sort()
}

async function requestSlackOauthTokens(body: URLSearchParams) {
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    body: body.toString(),
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  })
  const result = (await response.json().catch(() => ({}))) as SlackOauthResponse
  if (!response.ok || !result.ok) {
    throw new Error(result.error ?? "Slack rejected the OAuth token request.")
  }
  return result
}

export async function exchangeSlackIntegrationCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
}: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}) {
  const result = await requestSlackOauthTokens(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    })
  )
  const teamId = result.team?.id
  const botToken = result.access_token
  const userToken = result.authed_user?.access_token
  if (!teamId || !botToken || !userToken) {
    throw new Error(
      "Slack did not return both the bot and MCP user authorizations. Check the configured bot and user scopes."
    )
  }
  const grantedScopes = scopesOf(result.authed_user?.scope)
  const missingScopes = SLACK_MCP_USER_SCOPES.filter(
    (scope) => !grantedScopes.includes(scope)
  )
  if (missingScopes.length > 0) {
    throw new Error(
      `Slack did not grant the MCP scopes configured for CloudCode: ${missingScopes.join(", ")}.`
    )
  }

  return {
    installation: {
      botToken,
      botUserId: result.bot_user_id,
      teamName: result.team?.name,
    } satisfies SlackInstallation,
    mcpCredential: {
      accessToken: userToken,
      expiresAt: result.authed_user?.expires_in
        ? Date.now() + result.authed_user.expires_in * 1000
        : undefined,
      externalUserId: result.authed_user?.id,
      refreshToken: result.authed_user?.refresh_token,
      scopes: grantedScopes,
    },
    teamId,
  }
}

export async function refreshSlackMcpToken({
  clientId,
  clientSecret,
  refreshToken,
}: {
  clientId: string
  clientSecret: string
  refreshToken: string
}) {
  const result = await requestSlackOauthTokens(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
  )
  const user = result.authed_user
  const accessToken = user?.access_token ?? result.access_token
  if (!accessToken) throw new Error("Slack did not return a refreshed token.")
  const expiresIn = user?.expires_in ?? result.expires_in
  return {
    accessToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    refreshToken: user?.refresh_token ?? result.refresh_token,
  }
}

export async function revokeSlackToken(accessToken: string) {
  const response = await fetch("https://slack.com/api/auth.revoke", {
    headers: { Authorization: `Bearer ${accessToken}` },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  })
  const result = (await response.json().catch(() => ({}))) as {
    error?: string
    ok?: boolean
  }
  if (!response.ok || !result.ok) {
    throw new Error(result.error ?? "Slack rejected token revocation.")
  }
}
