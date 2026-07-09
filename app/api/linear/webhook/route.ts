import { tasks } from "@trigger.dev/sdk"
import { after } from "next/server"

import { jsonError } from "@/lib/http/api-route"
import { getIntegrationsBot } from "@/lib/integrations/bot"
import {
  integrationsStateRedisUrl,
  linearIntegrationEnv,
} from "@/lib/integrations/config"
import {
  parseLinearIssueAutomationEvents,
  verifyLinearWebhookRequest,
} from "@/lib/integrations/linear-webhook"
import type { integrationEvent } from "@/trigger/integrations"

export const runtime = "nodejs"

/** Issue data-change events (labels, workflow state) drive event
 * automations, but the Chat SDK adapter only dispatches comment and agent
 * session events — so the automation path reads the payload first, behind
 * its own signature check. Failures here never block the chat flow. */
async function dispatchIssueAutomationEvents(
  request: Request,
  webhookSecret: string
) {
  try {
    const rawBody = await request.clone().text()
    if (
      !verifyLinearWebhookRequest(
        rawBody,
        request.headers.get("linear-signature"),
        request.headers.get("linear-timestamp"),
        webhookSecret
      )
    ) {
      return
    }

    const { events, organizationId } = parseLinearIssueAutomationEvents(
      JSON.parse(rawBody)
    )
    if (events.length === 0 || !organizationId) return

    const deliveryId = request.headers.get("linear-delivery")
    await tasks.trigger<typeof integrationEvent>(
      "integration-event",
      {
        deliveryId: deliveryId ?? undefined,
        events,
        externalId: organizationId,
        kind: "linear_automation",
        provider: "linear",
      },
      deliveryId ? { idempotencyKey: `lind:${deliveryId}` } : undefined
    )
  } catch (error) {
    console.warn("/api/linear/webhook automation dispatch failed", error)
  }
}

// Linear is the caller: authentication is the HMAC signature over the raw
// body (LINEAR_WEBHOOK_SECRET); the Chat SDK adapter verifies it again for
// the agent-session flow it handles. Agent sessions expect a first activity
// within ~10 seconds, so the mention handler acks synchronously and defers
// the rest to Trigger via waitUntil.
export async function POST(request: Request) {
  const env = linearIntegrationEnv()
  if (!env || !integrationsStateRedisUrl()) {
    return jsonError("The Linear integration is not configured.", 503)
  }

  await dispatchIssueAutomationEvents(request, env.webhookSecret)

  const { bot } = getIntegrationsBot()
  return await bot.webhooks.linear(request, {
    waitUntil: (task) => after(() => task),
  })
}
