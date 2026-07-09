/** Environment wiring for the Slack/Linear chat integrations.
 *
 * Slack supports two modes. OAuth mode (SLACK_CLIENT_ID/SECRET) is the
 * default UX: "Connect Slack" runs the browser install and the per-workspace
 * bot token lands in the Chat SDK state store, encrypted with
 * SLACK_ENCRYPTION_KEY. Token mode (SLACK_BOT_TOKEN) pins one workspace's
 * token in env and wins when both are set. Linear always runs through its
 * OAuth app (actor=app, agent sessions) with tokens in the state store,
 * encrypted with LINEAR_ENCRYPTION_KEY.
 */

export const INTEGRATIONS_BOT_USERNAME = "cloudcode"

export const LINEAR_OAUTH_STATE_COOKIE = "cloudcode_linear_oauth_state"
export const SLACK_OAUTH_STATE_COOKIE = "cloudcode_slack_oauth_state"

/** Bot scopes requested on install; must stay a subset of the scopes listed
 * in the Slack app manifest. */
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "chat:write",
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "reactions:read",
  "reactions:write",
  "users:read",
  "users:read.email",
]

export type SlackIntegrationEnv =
  | { botToken: string; mode: "token"; signingSecret: string }
  | {
      clientId: string
      clientSecret: string
      encryptionKey?: string
      mode: "oauth"
      signingSecret: string
    }

export function slackIntegrationEnv(): SlackIntegrationEnv | null {
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim()
  if (!signingSecret) return null

  const botToken = process.env.SLACK_BOT_TOKEN?.trim()
  if (botToken) return { botToken, mode: "token", signingSecret }

  const clientId = process.env.SLACK_CLIENT_ID?.trim()
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim()
  if (clientId && clientSecret) {
    return {
      clientId,
      clientSecret,
      encryptionKey: process.env.SLACK_ENCRYPTION_KEY?.trim() || undefined,
      mode: "oauth",
      signingSecret,
    }
  }

  return null
}

export function linearIntegrationEnv() {
  const clientId = process.env.LINEAR_CLIENT_ID?.trim()
  const clientSecret = process.env.LINEAR_CLIENT_SECRET?.trim()
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET?.trim()
  return clientId && clientSecret && webhookSecret
    ? { clientId, clientSecret, webhookSecret }
    : null
}

/** TCP endpoint of the existing Upstash Redis instance (rediss://…). The
 * Chat SDK state adapter needs the Redis protocol; the REST credentials used
 * for run streaming cannot serve it. */
export function integrationsStateRedisUrl() {
  return process.env.INTEGRATIONS_REDIS_URL?.trim() || null
}

export function integrationsConfigured() {
  return (
    Boolean(integrationsStateRedisUrl()) &&
    Boolean(slackIntegrationEnv() || linearIntegrationEnv())
  )
}

export function appBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || null
}

export function appThreadUrl(threadId: string) {
  const base = appBaseUrl()
  return base ? `${base}/?thread=${threadId}` : null
}
