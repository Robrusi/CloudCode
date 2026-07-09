import type { LinearAdapter, LinearRawMessage } from "@chat-adapter/linear"
import type { SlackAdapter, SlackEvent } from "@chat-adapter/slack"
import { tasks } from "@trigger.dev/sdk"
import type { Adapter, Chat, Message, ReactionEvent, Thread } from "chat"
import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import { requireConvexUrl } from "@/lib/convex/env"
import { INTEGRATIONS_BOT_USERNAME } from "@/lib/integrations/config"
import {
  type IntegrationChatEventPayload,
  type IntegrationEventPayload,
  type IntegrationEventSubject,
} from "@/lib/integrations/events"
import { parseIntegrationMessage } from "@/lib/integrations/keywords"
import { getWorkerSecret } from "@/lib/security/worker-secret"
import type { integrationEvent } from "@/trigger/integrations"

const WORKER_SECRET_ERROR =
  "Set TRIGGER_WORKER_SECRET before handling integration events."

function convexClient() {
  return new ConvexHttpClient(requireConvexUrl())
}

function providerOfThread(threadId: string): "slack" | "linear" | null {
  if (threadId.startsWith("slack:")) return "slack"
  if (threadId.startsWith("linear:")) return "linear"
  return null
}

async function enqueueIntegrationEvent(
  payload: IntegrationEventPayload,
  idempotencyKey: string
) {
  await tasks.trigger<typeof integrationEvent>("integration-event", payload, {
    idempotencyKey,
  })
}

async function subjectOf(
  message: Message
): Promise<IntegrationEventSubject | undefined> {
  const subject = await message.subject.catch(() => null)
  if (!subject) return undefined
  return {
    description: subject.description,
    labels: subject.labels,
    status: subject.status,
    title: subject.title,
    url: subject.url,
  }
}

async function slackAuthorEmail(
  slack: SlackAdapter | null,
  userId: string
): Promise<string | undefined> {
  if (!slack) return undefined
  const user = await slack.getUser(userId).catch(() => null)
  return user?.email ?? undefined
}

function linearRawOf(message: Message) {
  const raw = message.raw as LinearRawMessage | undefined
  return raw && typeof raw === "object" && "organizationId" in raw ? raw : null
}

async function chatEventPayload(
  provider: "slack" | "linear",
  adapters: { linear: LinearAdapter | null; slack: SlackAdapter | null },
  thread: Thread,
  message: Message,
  kind: "mention" | "follow_up",
  text: string,
  repoOverride: string | undefined
): Promise<IntegrationChatEventPayload> {
  const payload: IntegrationChatEventPayload = {
    authorName: message.author.fullName || message.author.userName,
    externalThreadId: thread.id,
    kind,
    messageId: message.id,
    provider,
    repoOverride,
    text,
  }

  if (provider === "slack") {
    const raw = message.raw as SlackEvent | undefined
    payload.externalId = raw?.team_id ?? raw?.team
    payload.authorEmail = await slackAuthorEmail(
      adapters.slack,
      message.author.userId
    )
    return payload
  }

  const raw = linearRawOf(message)
  payload.externalId = raw?.organizationId
  // Defensive: a delegated session's first event can arrive without a
  // backing comment even though the type declares one.
  payload.authorEmail = raw?.comment?.user?.email
  payload.subject = await subjectOf(message)
  if (adapters.linear) {
    const decoded = adapters.linear.decodeThreadId(thread.id)
    payload.linearIssueId = decoded.issueId
    payload.linearAgentSessionId = decoded.agentSessionId
  }
  return payload
}

/** Immediate in-channel acknowledgement, before any queue work: Slack gets
 * an eyes reaction, Linear agent sessions get an ephemeral thought so the
 * session never reads as unresponsive inside its 10-second window. */
async function acknowledge(
  provider: "slack" | "linear",
  thread: Thread,
  message: Message
) {
  if (provider === "slack") {
    await thread.adapter
      .addReaction(thread.id, message.id, "eyes")
      .catch(() => undefined)
    return
  }
  await thread
    .startTyping("Starting a CloudCode session…")
    .catch(() => undefined)
}

/** Registers the inbound event handlers. Every handler follows the same
 * shape: filter, acknowledge, and enqueue an integration-event Trigger task —
 * all decisions (identity, repo, run creation) happen in the worker. */
export function registerIntegrationHandlers(
  bot: Chat<Record<string, Adapter>>,
  adapters: { linear: LinearAdapter | null; slack: SlackAdapter | null }
) {
  const handleChatMessage = async (
    thread: Thread,
    message: Message,
    kind: "mention" | "follow_up"
  ) => {
    if (message.author.isBot === true || message.author.isMe) return
    const provider = providerOfThread(thread.id)
    if (!provider) return

    const parsed = parseIntegrationMessage(
      message.text,
      INTEGRATIONS_BOT_USERNAME
    )

    // Mute controls resolve inline: they need no run, and the confirmation
    // reaction doubles as the ack.
    if (parsed.control === "mute" || parsed.control === "unmute") {
      const muted = parsed.control === "mute"
      await convexClient().mutation(api.integrations.workerSetMuted, {
        externalThreadId: thread.id,
        muted,
        provider,
        workerSecret: getWorkerSecret(WORKER_SECRET_ERROR),
      })
      if (provider === "slack") {
        await thread.adapter
          .addReaction(thread.id, message.id, muted ? "mute" : "loud_sound")
          .catch(() => undefined)
      } else {
        await thread
          .post(muted ? "Muted — mention me to resume." : "Unmuted.")
          .catch(() => undefined)
      }
      return
    }

    if (kind === "mention") await thread.subscribe().catch(() => undefined)
    await acknowledge(provider, thread, message)

    const payload = await chatEventPayload(
      provider,
      adapters,
      thread,
      message,
      kind,
      parsed.text,
      parsed.repoOverride
    )
    await enqueueIntegrationEvent(payload, `${provider}:${kind}:${message.id}`)
  }

  bot.onNewMention(async (thread, message) => {
    await handleChatMessage(thread, message, "mention")
  })

  bot.onSubscribedMessage(async (thread, message) => {
    // Follow-ups only make sense where a session bridge can exist; muted
    // bridges are filtered in the worker where the bridge row lives.
    await handleChatMessage(thread, message, "follow_up")
  })

  // Slack channel messages that never mention the bot only matter when a
  // keyword automation watches the channel; one Convex query decides that
  // before anything is enqueued.
  bot.onNewMessage(/[\s\S]*/, async (thread, message) => {
    if (message.author.isBot === true || message.author.isMe) return
    if (message.isMention || thread.isDM) return
    if (providerOfThread(thread.id) !== "slack") return

    const raw = message.raw as SlackEvent | undefined
    const matches = await convexClient().query(
      api.integrations.workerMatchSlackEvent,
      {
        channelId: thread.channelId,
        event: "keyword",
        externalId: raw?.team_id ?? raw?.team,
        text: message.text,
        workerSecret: getWorkerSecret(WORKER_SECRET_ERROR),
      }
    )
    if (matches.length === 0) return

    await enqueueIntegrationEvent(
      {
        authorName: message.author.fullName || message.author.userName,
        automationIds: matches.map((match) => match.automationId),
        channelId: thread.channelId,
        event: "keyword",
        externalThreadId: thread.id,
        kind: "slack_automation",
        messageId: message.id,
        messageText: message.text,
        provider: "slack",
      },
      `slack:keyword:${message.id}`
    )
  })

  bot.onReaction(async (event: ReactionEvent) => {
    if (!event.added || event.user.isBot === true || event.user.isMe) return
    if (providerOfThread(event.threadId) !== "slack") return

    const matches = await convexClient().query(
      api.integrations.workerMatchSlackEvent,
      {
        channelId: event.thread.channelId,
        emoji: event.rawEmoji,
        event: "reaction",
        workerSecret: getWorkerSecret(WORKER_SECRET_ERROR),
      }
    )
    if (matches.length === 0) return

    await enqueueIntegrationEvent(
      {
        authorName: event.user.fullName || event.user.userName,
        automationIds: matches.map((match) => match.automationId),
        channelId: event.thread.channelId,
        emoji: event.rawEmoji,
        event: "reaction",
        externalThreadId: event.threadId,
        kind: "slack_automation",
        messageId: event.messageId,
        messageText: event.message?.text,
        provider: "slack",
      },
      `slack:reaction:${event.messageId}:${event.rawEmoji}:${event.user.userId}`
    )
  })
}
