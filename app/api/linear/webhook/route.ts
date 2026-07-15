import { createHash } from "node:crypto"
import { tasks } from "@trigger.dev/sdk"
import { ConvexHttpClient } from "convex/browser"
import { after } from "next/server"

import { api } from "@/convex/_generated/api"
import { requireConvexUrl } from "@/lib/convex/env"
import { jsonError } from "@/lib/http/api-route"
import {
  linearWaitEventVars,
  type LinearAutomationEvent,
} from "@/lib/integrations/events"
import { getWorkerSecret } from "@/lib/security/worker-secret"
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

/** Factory waits: new comments on issues an agent registered a wait for.
 * Pre-matched with one indexed Convex query per commented issue so ordinary
 * Linear traffic costs no Trigger task. */
async function dispatchLinearWaitEvents(
  events: LinearAutomationEvent[],
  organizationId: string,
  deliveryId: string
) {
  const comments = events.filter(
    (event) => event.event === "commentCreated" && event.comment
  )
  if (comments.length === 0) return

  const client = new ConvexHttpClient(requireConvexUrl())
  for (const event of comments) {
    const matches = await client.query(
      api.factoryWaits.workerMatchLinearWaitEvent,
      {
        actorId: event.comment?.authorId,
        externalId: organizationId,
        issueId: event.issue.id,
        workerSecret: getWorkerSecret(),
      }
    )
    if (matches.length === 0) continue

    await tasks.trigger<typeof integrationEvent>(
      "integration-event",
      {
        eventKey: event.comment?.id ?? deliveryId,
        eventName: "comment",
        eventVars: linearWaitEventVars(event),
        kind: "wait_event",
        provider: "linear",
        waits: matches.map((match) => ({
          threadId: match.threadId,
          waitId: match.waitId,
        })),
      },
      { idempotencyKey: `fwl:${event.comment?.id ?? deliveryId}` }
    )
  }
}

/** Reads verified events the Chat SDK does not dispatch: Issue/Comment data
 * changes for automations and direct agent delegations without a backing
 * comment. Automation handoff failures are returned to Linear so it retries. */
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

    const deliveryId =
      request.headers.get("linear-delivery") ??
      `body:${createHash("sha256").update(rawBody).digest("hex")}`
    if (events.length > 0 && organizationId) {
      await tasks.trigger<typeof integrationEvent>(
        "integration-event",
        {
          deliveryId,
          events,
          externalId: organizationId,
          kind: "linear_automation",
          provider: "linear",
        },
        { idempotencyKey: `lind:${deliveryId}` }
      )
      await dispatchLinearWaitEvents(events, organizationId, deliveryId)
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
    throw error
  }
}

// Linear is the caller: authentication is the HMAC signature over the raw
// body (LINEAR_WEBHOOK_SECRET); the Chat SDK adapter verifies it again for
// the comment-backed agent-session flow it handles. Agent sessions expect a
// first activity within ~10 seconds. Automation events are handed to Trigger
// before acknowledgement; agent-session chat work stays on waitUntil.
export async function POST(request: Request) {
  const env = linearIntegrationEnv()
  if (!env || !integrationsStateRedisUrl()) {
    return jsonError("The Linear integration is not configured.", 503)
  }

  try {
    await dispatchPreprocessedEvents(request, env.webhookSecret)
  } catch {
    return jsonError("Unable to dispatch Linear automation event.", 500)
  }

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
