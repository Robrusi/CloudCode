import { createHash } from "node:crypto"
import { tasks } from "@trigger.dev/sdk"
import { ConvexHttpClient } from "convex/browser"
import { after } from "next/server"

import { api } from "@/convex/_generated/api"
import { requireConvexUrl } from "@/lib/convex/env"
import { jsonError } from "@/lib/http/api-route"
import { getIntegrationsBot } from "@/lib/integrations/bot"
import {
  integrationsStateRedisUrl,
  slackIntegrationEnv,
} from "@/lib/integrations/config"
import {
  slackWebhookContextFromRequest,
  withSlackWebhookContext,
} from "@/lib/integrations/slack-webhook-context"
import { createWebhookTaskTracker } from "@/lib/integrations/webhook-tasks"
import {
  parseSlackAutomationWebhookEvent,
  verifySlackWebhookRequest,
} from "@/lib/integrations/slack-webhook"
import { getWorkerSecret } from "@/lib/security/worker-secret"
import type { integrationEvent } from "@/trigger/integrations"

export const runtime = "nodejs"

async function dispatchAutomationEvent(
  request: Request,
  signingSecret: string
) {
  const rawBody = await request.clone().text()
  if (
    !verifySlackWebhookRequest(
      rawBody,
      request.headers.get("x-slack-signature"),
      request.headers.get("x-slack-request-timestamp"),
      signingSecret
    )
  ) {
    return
  }

  const event = parseSlackAutomationWebhookEvent(JSON.parse(rawBody))
  if (!event) return
  const eventId =
    event.eventId ??
    `body:${createHash("sha256").update(rawBody).digest("hex")}`
  const client = new ConvexHttpClient(requireConvexUrl())
  const matches = await client.query(api.integrations.workerMatchSlackEvent, {
    actorUserId: event.actorUserId,
    channelId: event.channelId,
    emoji: event.emoji,
    event: event.event,
    externalId: event.externalId,
    text: event.messageText,
    workerSecret: getWorkerSecret(),
  })
  if (matches.length === 0) return

  await tasks.trigger<typeof integrationEvent>(
    "integration-event",
    {
      ...event,
      eventId,
      automationIds: matches.map((match) => match.automationId),
      kind: "slack_automation",
      provider: "slack",
    },
    {
      idempotencyKey: `sla:${eventId}`,
    }
  )
}

// Slack is the caller: automation events are verified and durably handed to
// Trigger before acknowledgement, while the Chat SDK verifies the signature
// again and runs mention/follow-up handlers through waitUntil.
export async function POST(request: Request) {
  const env = slackIntegrationEnv()
  if (!env || !integrationsStateRedisUrl()) {
    return jsonError("The Slack integration is not configured.", 503)
  }

  try {
    await dispatchAutomationEvent(request, env.signingSecret)
  } catch (error) {
    console.error("/api/slack/webhook automation dispatch failed", error)
    return jsonError("Unable to dispatch Slack automation event.", 500)
  }

  const context = await slackWebhookContextFromRequest(request)
  const { bot } = getIntegrationsBot()
  const background = createWebhookTaskTracker((error) => {
    console.error("Slack webhook background task failed.", error)
  })
  const response = await withSlackWebhookContext(context, () =>
    bot.webhooks.slack(request, {
      waitUntil: background.waitUntil,
    })
  )
  const completion = background.finish()
  after(() => completion)
  return response
}
