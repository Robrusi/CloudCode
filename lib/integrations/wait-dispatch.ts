import { tasks } from "@trigger.dev/sdk"
import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import {
  githubWaitEventName,
  githubWaitSourceKey,
} from "@/convex/lib/factoryWaitTriggers"
import { requireConvexUrl } from "@/lib/convex/env"
import type { GitHubAutomationEvent } from "@/lib/github/automation-events"
import {
  isCloudcodeActor,
  isTrustedGitHubAssociation,
} from "@/lib/github/webhook"
import {
  githubWaitEventVars,
  githubWaitPullRequestNumbers,
  linearWaitEventVars,
  type LinearAutomationEvent,
} from "@/lib/integrations/events"
import { slackThreadParts } from "@/lib/integrations/slack-threads"
import type { SlackAutomationWebhookEvent } from "@/lib/integrations/slack-webhook"
import { getWorkerSecret } from "@/lib/security/worker-secret"
import type { integrationEvent } from "@/trigger/integrations"

/**
 * Factory-wait matching and dispatch for the provider webhook routes. Each
 * helper pre-matches armed waits with one indexed Convex query and enqueues
 * the integration-event task only on a hit, so unmatched provider traffic
 * costs no Trigger run. Kept out of the routes so they stay thin: verify,
 * call, respond.
 */

/** Does this Slack channel or DM message/reaction land on a thread or
 * message an agent registered a wait for? Replies match on their thread root
 * ts, reactions on the reacted message's ts. */
export async function dispatchSlackWaitEvent(
  client: ConvexHttpClient,
  event: SlackAutomationWebhookEvent,
  eventId: string
) {
  const waitEventName = event.event === "reaction" ? "reaction" : "reply"
  const messageTs =
    event.event === "reaction"
      ? event.messageId
      : (slackThreadParts(event.externalThreadId).threadTs ?? event.messageId)
  const matches = await client.query(
    api.factoryWaits.workerMatchSlackWaitEvent,
    {
      actorUserId: event.actorUserId,
      channelId: event.channelId,
      event: waitEventName,
      externalId: event.externalId,
      messageTs,
      workerSecret: getWorkerSecret(),
    }
  )
  if (matches.length === 0) return false

  await tasks.trigger<typeof integrationEvent>(
    "integration-event",
    {
      eventKey: eventId,
      eventName: waitEventName,
      eventVars: {
        channel: event.channelId,
        emoji: event.emoji ?? "",
        event: waitEventName,
        messageTs: event.messageId,
        text: event.messageText ?? "",
        workspace: event.externalId,
      },
      externalThreadId: event.externalThreadId,
      kind: "wait_event",
      provider: "slack",
      receivedAt: Date.now(),
      slack: {
        actorUserId: event.actorUserId,
        externalId: event.externalId,
      },
      waits: matches.map((match) => ({
        threadId: match.threadId,
        waitId: match.waitId,
      })),
    },
    {
      idempotencyKey: `fws:${eventId}`,
    }
  )
  return true
}

/** Does this GitHub event land on a PR an agent registered a wait for?
 * Best-effort by design: GitHub does not redeliver failed webhooks, and a
 * wait-subsystem outage must never drop the review and automation dispatches
 * sharing the delivery — an undelivered wait event still resolves through
 * the wait's TTL timeout. */
export async function dispatchGitHubWaitEvent(
  event: GitHubAutomationEvent,
  deliveryId: string | null
) {
  try {
    const eventName = githubWaitEventName(event.event)
    if (!eventName) return false
    // Comments and reviews carry actor-authored text straight into a
    // privileged continuation run's prompt, so they wake a wait only from
    // trusted authors (owner/member/collaborator — the same rule as app
    // mentions): on a public repository any GitHub account can comment, and
    // an untrusted account must not be able to place instructions in front
    // of the agent. The agent's own posts (the app's bot) never wake it.
    // State changes (merged, closed, reopened, checks) carry no authored
    // text and count regardless of the actor.
    if (eventName === "comment" || eventName === "review") {
      if (isCloudcodeActor(event.actorLogin)) return false
      if (!isTrustedGitHubAssociation(event.actorAssociation)) return false
    }
    const prNumbers = githubWaitPullRequestNumbers(event)
    if (prNumbers.length === 0) return false

    const client = new ConvexHttpClient(requireConvexUrl())
    const matches = await client.query(api.factoryWaits.workerMatchWaitEvents, {
      sourceKeys: prNumbers.map((number) =>
        githubWaitSourceKey(event.repoUrl, number)
      ),
      workerSecret: getWorkerSecret(),
    })
    const waits = matches
      .filter((match) => match.events.includes(eventName))
      .map((match) => ({ threadId: match.threadId, waitId: match.waitId }))
    if (waits.length === 0) return false

    await tasks.trigger<typeof integrationEvent>(
      "integration-event",
      {
        eventKey:
          deliveryId ??
          `${event.event}:${prNumbers.join(",")}:${event.comment?.id ?? event.actorLogin ?? "unknown"}`,
        eventName,
        eventVars: githubWaitEventVars(event, eventName),
        kind: "wait_event",
        provider: "github",
        receivedAt: Date.now(),
        waits,
      },
      deliveryId ? { idempotencyKey: `fwg:${deliveryId}` } : undefined
    )
    return true
  } catch (error) {
    console.error("GitHub wait event dispatch failed.", error)
    return false
  }
}

/** New comments on Linear issues an agent registered a wait for. Throws on
 * failure so the route returns 500 and Linear redelivers. */
export async function dispatchLinearWaitEvents(
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
        receivedAt: Date.now(),
        waits: matches.map((match) => ({
          threadId: match.threadId,
          waitId: match.waitId,
        })),
      },
      { idempotencyKey: `fwl:${event.comment?.id ?? deliveryId}` }
    )
  }
}
