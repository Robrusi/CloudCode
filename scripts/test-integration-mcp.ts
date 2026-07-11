import assert from "node:assert/strict"

import {
  INTEGRATION_MCP_SERVERS,
  SLACK_MCP_USER_SCOPES,
} from "../lib/integrations/mcp"
import {
  exchangeSlackIntegrationCode,
  refreshSlackMcpToken,
} from "../lib/integrations/slack-oauth"

assert.equal(INTEGRATION_MCP_SERVERS.slack.url, "https://mcp.slack.com/mcp")
assert.equal(INTEGRATION_MCP_SERVERS.linear.url, "https://mcp.linear.app/mcp")
assert.equal(new Set(SLACK_MCP_USER_SCOPES).size, SLACK_MCP_USER_SCOPES.length)

const originalFetch = globalThis.fetch
try {
  let requestBody = ""
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body ?? "")
    return new Response(
      JSON.stringify({
        access_token: "xoxb-bot",
        authed_user: {
          access_token: "xoxp-user",
          expires_in: 3600,
          id: "U123",
          refresh_token: "xoxe-user-refresh",
          scope: SLACK_MCP_USER_SCOPES.join(","),
        },
        bot_user_id: "U-BOT",
        ok: true,
        team: { id: "T123", name: "Acme" },
      }),
      { headers: { "content-type": "application/json" } }
    )
  }

  const exchanged = await exchangeSlackIntegrationCode({
    clientId: "client-id",
    clientSecret: "client-secret",
    code: "oauth-code",
    redirectUri: "https://cloudcode.test/api/slack/oauth/callback",
  })
  assert.equal(exchanged.installation.botToken, "xoxb-bot")
  assert.equal(exchanged.mcpCredential.accessToken, "xoxp-user")
  assert.equal(exchanged.mcpCredential.refreshToken, "xoxe-user-refresh")
  assert.equal(exchanged.teamId, "T123")
  assert.equal(new URLSearchParams(requestBody).get("code"), "oauth-code")

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: "xoxb-bot",
        authed_user: {
          access_token: "xoxp-user",
          scope: "chat:write",
        },
        ok: true,
        team: { id: "T123" },
      }),
      { headers: { "content-type": "application/json" } }
    )
  await assert.rejects(
    exchangeSlackIntegrationCode({
      clientId: "client-id",
      clientSecret: "client-secret",
      code: "oauth-code",
      redirectUri: "https://cloudcode.test/api/slack/oauth/callback",
    }),
    /did not grant the MCP scopes/
  )

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: "xoxp-rotated",
        expires_in: 7200,
        ok: true,
        refresh_token: "xoxe-rotated",
      }),
      { headers: { "content-type": "application/json" } }
    )
  const refreshed = await refreshSlackMcpToken({
    clientId: "client-id",
    clientSecret: "client-secret",
    refreshToken: "xoxe-old",
  })
  assert.equal(refreshed.accessToken, "xoxp-rotated")
  assert.equal(refreshed.refreshToken, "xoxe-rotated")
  assert.ok((refreshed.expiresAt ?? 0) > Date.now())
} finally {
  globalThis.fetch = originalFetch
}

console.log("Integration-backed MCP checks passed.")
