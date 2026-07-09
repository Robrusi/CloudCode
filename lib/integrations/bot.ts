import { createLinearAdapter, type LinearAdapter } from "@chat-adapter/linear"
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack"
import { createIoRedisState } from "@chat-adapter/state-ioredis"
import { Chat, type Adapter } from "chat"

import {
  INTEGRATIONS_BOT_USERNAME,
  integrationsStateRedisUrl,
  linearIntegrationEnv,
  slackIntegrationEnv,
} from "@/lib/integrations/config"
import { registerIntegrationHandlers } from "@/lib/integrations/handlers"

export type IntegrationsBot = {
  bot: Chat<Record<string, Adapter>>
  linear: LinearAdapter | null
  slack: SlackAdapter | null
}

let cached: IntegrationsBot | null = null

/** Lazy singleton Chat instance shared by the webhook routes (inbound
 * events) and the Trigger.dev workers (outbound posts). Adapters register
 * only for the providers whose env is configured. */
export function getIntegrationsBot(): IntegrationsBot {
  if (cached) return cached

  const redisUrl = integrationsStateRedisUrl()
  if (!redisUrl) {
    throw new Error(
      "Set INTEGRATIONS_REDIS_URL (Upstash Redis TCP endpoint) to enable the Slack/Linear integrations."
    )
  }

  const slackEnv = slackIntegrationEnv()
  const linearEnv = linearIntegrationEnv()
  if (!slackEnv && !linearEnv) {
    throw new Error(
      "Configure SLACK_BOT_TOKEN/SLACK_SIGNING_SECRET or LINEAR_CLIENT_ID/LINEAR_CLIENT_SECRET/LINEAR_WEBHOOK_SECRET to enable integrations."
    )
  }

  const slack = slackEnv
    ? createSlackAdapter(
        slackEnv.mode === "token"
          ? {
              botToken: slackEnv.botToken,
              signingSecret: slackEnv.signingSecret,
            }
          : {
              clientId: slackEnv.clientId,
              clientSecret: slackEnv.clientSecret,
              encryptionKey: slackEnv.encryptionKey,
              signingSecret: slackEnv.signingSecret,
            }
      )
    : null
  const linear = linearEnv
    ? createLinearAdapter({
        clientId: linearEnv.clientId,
        clientSecret: linearEnv.clientSecret,
        mode: "agent-sessions",
        userName: INTEGRATIONS_BOT_USERNAME,
        webhookSecret: linearEnv.webhookSecret,
      })
    : null

  const adapters: Record<string, Adapter> = {}
  if (slack) adapters.slack = slack
  if (linear) adapters.linear = linear

  const bot = new Chat({
    adapters,
    // Handlers only ack and enqueue Trigger tasks, so parallel processing is
    // safe and nothing is dropped while a handler holds a thread lock.
    concurrency: "concurrent",
    state: createIoRedisState({ url: redisUrl }),
    userName: INTEGRATIONS_BOT_USERNAME,
  })

  registerIntegrationHandlers(bot, { linear, slack })

  cached = { bot, linear, slack }
  return cached
}
