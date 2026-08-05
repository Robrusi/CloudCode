import { tasks } from "@trigger.dev/sdk"
import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import {
  githubInstallationWaitSourceKey,
  githubWaitEventName,
  githubWaitSourceKey,
} from "@/convex/lib/factoryWaitTriggers"
import {
  githubEventTriggerSourceKey,
  githubInstallationEventTriggerSourceKey,
} from "@/convex/lib/integrationTriggers"
import { requireConvexUrl } from "@/lib/convex/env"
import type { GitHubAutomationEvent } from "@/lib/github/automation-events"
import {
  isCloudcodeActor,
  isTrustedGitHubAssociation,
} from "@/lib/github/webhook"
import {
  githubEventWaitVars,
  githubWaitPullRequestNumbers,
  githubIntegrationEventMatches,
  linearEventWaitVars,
  linearIntegrationEventMatches,
  type FactoryWaitEventPayload,
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

/** Match a durably persisted GitHub candidate to PR-specific and filtered
 * repository waits. The webhook route stores the candidate before enqueue;
 * this worker may therefore throw and retry without losing the delivery. */
export async function matchGitHubWaitEvent(
  client: ConvexHttpClient,
  event: GitHubAutomationEvent,
  deliveryId: string | undefined,
  receivedAt: number
): Promise<FactoryWaitEventPayload | null> {
  const specificEventName = githubWaitEventName(event.event)
  // Comments and reviews carry actor-authored text straight into a
  // privileged continuation run's prompt, so they wake a wait only from
  // trusted authors (owner/member/collaborator — the same rule as app
  // mentions): on a public repository any GitHub account can comment, and
  // an untrusted account must not be able to place instructions in front
  // of the agent. The agent's own posts (the app's bot) never wake it.
  // State changes (merged, closed, reopened, checks) carry no authored
  // text and count regardless of the actor.
  if (specificEventName === "comment" || specificEventName === "review") {
    if (isCloudcodeActor(event.actorLogin)) return null
    if (!isTrustedGitHubAssociation(event.actorAssociation)) return null
  }
  const prNumbers = githubWaitPullRequestNumbers(event).slice(0, 10)

  const matches = await client.query(api.factoryWaits.workerMatchWaitEvents, {
    githubInstallationId: event.installationId,
    sourceKeys: [
      githubInstallationEventTriggerSourceKey(
        event.installationId,
        event.repoUrl,
        event.event
      ),
      githubEventTriggerSourceKey(event.repoUrl, event.event),
      ...(specificEventName
        ? prNumbers.flatMap((number) => [
            githubInstallationWaitSourceKey(
              event.installationId,
              event.repoUrl,
              number
            ),
            githubWaitSourceKey(event.repoUrl, number),
          ])
        : []),
    ],
    workerSecret: getWorkerSecret(),
  })
  const waits = matches
    .filter((match) => {
      if (match.eventTrigger?.kind === "github") {
        return (
          !isCloudcodeActor(event.actorLogin) &&
          githubIntegrationEventMatches(match.eventTrigger, event)
        )
      }
      return Boolean(
        specificEventName && match.events.includes(specificEventName)
      )
    })
    .map((match) => ({
      eventName:
        match.eventTrigger?.kind === "github"
          ? event.event
          : specificEventName!,
      threadId: match.threadId,
      waitId: match.waitId,
    }))
  if (waits.length === 0) return null

  return {
    eventKey:
      deliveryId ??
      `${event.event}:${prNumbers.join(",")}:${event.comment?.id ?? event.review?.url ?? event.push?.after ?? event.actorLogin ?? "unknown"}`,
    eventName: event.event,
    eventVars: githubEventWaitVars(event),
    kind: "wait_event",
    provider: "github",
    receivedAt,
    waits,
  }
}

/** Linear issue and comment events that match an agent-registered wait.
 * Throws on failure so the route returns 500 and Linear redelivers. */
export async function dispatchLinearWaitEvents(
  events: LinearAutomationEvent[],
  organizationId: string,
  deliveryId: string
) {
  if (events.length === 0) return

  const client = new ConvexHttpClient(requireConvexUrl())
  for (const event of events) {
    const matches = await client.query(
      api.factoryWaits.workerMatchLinearWaitEvent,
      {
        actorId: event.comment?.authorId ?? event.actorId,
        event: event.event,
        externalId: organizationId,
        issueId: event.issue.id,
        workerSecret: getWorkerSecret(),
      }
    )
    const waits = matches
      .filter((match) =>
        match.eventTrigger?.kind === "linear"
          ? linearIntegrationEventMatches(match.eventTrigger, event)
          : event.event === "commentCreated" && match.events.includes("comment")
      )
      .map((match) => ({
        eventName:
          match.eventTrigger?.kind === "linear" ? event.event : "comment",
        threadId: match.threadId,
        waitId: match.waitId,
      }))
    if (waits.length === 0) continue

    const eventKey =
      event.comment?.id ?? `${deliveryId}:${event.event}:${event.issue.id}`

    await tasks.trigger<typeof integrationEvent>(
      "integration-event",
      {
        eventKey,
        eventName: event.event,
        eventVars: linearEventWaitVars(event),
        kind: "wait_event",
        provider: "linear",
        receivedAt: Date.now(),
        waits,
      },
      { idempotencyKey: `fwl:${eventKey}` }
    )
  }
}
