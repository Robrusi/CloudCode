import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import { getConvexAuthToken } from "@/lib/codex/auth"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { jsonError } from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import { getIntegrationsBot } from "@/lib/integrations/bot"
import { slackIntegrationEnv } from "@/lib/integrations/config"

export const runtime = "nodejs"

/** The bot token for Web API calls: the env token in token mode, or the
 * connected workspace's stored installation token in OAuth mode. */
async function resolveSlackBotToken(): Promise<string | null> {
  const env = slackIntegrationEnv()
  if (!env) return null
  if (env.mode === "token") return env.botToken

  const client = await currentUserConvexHttpClient()
  const installations = await client.query(api.integrations.list, {})
  const slackInstallation = installations.find(
    (installation) => installation.provider === "slack"
  )
  if (!slackInstallation) return null

  const { slack } = getIntegrationsBot()
  const installation = await slack?.getInstallation(
    slackInstallation.externalId
  )
  return installation?.botToken ?? null
}

type SlackConversationsResponse = {
  channels?: Array<{ id?: string; is_archived?: boolean; name?: string }>
  error?: string
  ok: boolean
  response_metadata?: { next_cursor?: string }
}

const MAX_PAGES = 5

/** Channel options for the automations trigger picker. Only channels the
 * bot can see are listed; private channels appear once the bot is invited. */
export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  if (!slackIntegrationEnv()) {
    return jsonError("The Slack integration is not configured.", 503)
  }

  try {
    await getConvexAuthToken()
  } catch {
    return jsonError("Sign in first.", 401)
  }

  try {
    const botToken = await resolveSlackBotToken()
    if (!botToken) {
      return jsonError("Connect Slack first.", 400)
    }

    const channels: Array<{ id: string; name: string }> = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        exclude_archived: "true",
        limit: "200",
        types: "public_channel,private_channel",
      })
      if (cursor) params.set("cursor", cursor)

      const response = await fetch(
        `https://slack.com/api/conversations.list?${params}`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${botToken}` },
        }
      )
      const data = (await response.json()) as SlackConversationsResponse
      if (!data.ok) {
        return jsonError(
          `Slack channel listing failed${data.error ? ` (${data.error})` : ""}.`,
          502
        )
      }

      for (const channel of data.channels ?? []) {
        if (channel.id && channel.name && !channel.is_archived) {
          channels.push({ id: channel.id, name: channel.name })
        }
      }
      cursor = data.response_metadata?.next_cursor || undefined
      if (!cursor) break
    }

    channels.sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ channels })
  } catch (error) {
    console.error("/api/integrations/slack/channels failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Unable to list channels.",
      500
    )
  }
}
