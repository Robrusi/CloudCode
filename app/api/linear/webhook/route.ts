import { tasks } from "@trigger.dev/sdk"
import { after } from "next/server"

import { jsonError } from "@/lib/http/api-route"
import {
  getInitializedIntegrationsBot,
  getIntegrationsBot,
} from "@/lib/integrations/bot"
import {
  integrationsStateRedisUrl,
  linearIntegrationEnv,
} from "@/lib/integrations/config"
import {
  parseCommentlessLinearDelegation,
  parseLinearAutomationEvents,
  verifyLinearWebhookRequest,
} from "@/lib/integrations/linear-webhook"
import { createWebhookTaskTracker } from "@/lib/integrations/webhook-tasks"
import type { integrationEvent } from "@/trigger/integrations"

export const runtime = "nodejs"

/** Reads verified events the Chat SDK does not dispatch: Issue/Comment data
 * changes for automations and direct agent delegations without a backing
 * comment. Failures here never block the adapter's normal chat flow. */
async function dispatchPreprocessedEvents(
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

    const rawPayload: unknown = JSON.parse(rawBody)
    const delegation = parseCommentlessLinearDelegation(rawPayload)
    const { events, organizationId } = parseLinearAutomationEvents(rawPayload)

    const deliveryId = request.headers.get("linear-delivery")
    if (events.length > 0 && organizationId) {
      after(async () => {
        await tasks
          .trigger<typeof integrationEvent>(
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
          .catch((error) => {
            console.warn("Unable to enqueue Linear automation event.", error)
          })
      })
    }

    if (delegation) {
      after(async () => {
        const event = delegation.event
        const externalId = event.externalId
        if (!externalId) return
        let bot: Awaited<ReturnType<typeof getInitializedIntegrationsBot>>
        try {
          bot = await getInitializedIntegrationsBot()
          const installation = await bot.linear?.getInstallation(externalId)
          if (
            !installation ||
            installation.botUserId !== delegation.appUserId
          ) {
            console.warn("Ignoring Linear delegation for an unknown app user.")
            return
          }
        } catch (error) {
          console.warn("Unable to verify Linear delegation ownership.", error)
          return
        }

        // Linear expects prompt activity quickly. This acknowledgement is
        // best-effort; queueing the durable event must proceed even if the
        // provider is temporarily unable to accept the thought.
        await bot.linear
          ?.withInstallation(externalId, () =>
            bot.bot
              .thread(event.externalThreadId)
              .startTyping("Starting a CloudCode session…")
          )
          .catch((error) => {
            console.warn("Unable to acknowledge Linear delegation.", error)
          })

        await tasks
          .trigger<typeof integrationEvent>("integration-event", event, {
            idempotencyKey: `linear:delegation:${deliveryId ?? event.messageId}`,
          })
          .catch((error) => {
            console.warn("Unable to enqueue Linear delegation.", error)
          })
      })
    }
  } catch (error) {
    console.warn("/api/linear/webhook preprocessing failed", error)
  }
}

// Linear is the caller: authentication is the HMAC signature over the raw
// body (LINEAR_WEBHOOK_SECRET); the Chat SDK adapter verifies it again for
// the comment-backed agent-session flow it handles. Agent sessions expect a
// first activity within ~10 seconds, so both paths acknowledge promptly and
// defer durable work to Trigger via waitUntil.
export async function POST(request: Request) {
  const env = linearIntegrationEnv()
  if (!env || !integrationsStateRedisUrl()) {
    return jsonError("The Linear integration is not configured.", 503)
  }

  await dispatchPreprocessedEvents(request, env.webhookSecret)

  const { bot } = getIntegrationsBot()
  const background = createWebhookTaskTracker((error) => {
    console.error("Linear webhook background task failed.", error)
  })
  const response = await bot.webhooks.linear(request, {
    waitUntil: background.waitUntil,
  })
  const completion = background.finish()
  after(() => completion)
  return response
}
