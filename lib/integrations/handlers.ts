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
import {
  INTEGRATION_HELP_MESSAGE,
  parseIntegrationMessage,
} from "@/lib/integrations/keywords"
import { linearAgentSessionThreadId } from "@/lib/integrations/linear-threads"
import { normalizeSlackDmThreadId } from "@/lib/integrations/slack-threads"
import { currentSlackWebhookTeamId } from "@/lib/integrations/slack-webhook-context"
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

type ExternalThreadContext = {
  externalThreadId: string
  linearAgentSessionId?: string
  linearIssueId?: string
}

/** Resolves the durable bridge identity once for controls, queuing, and run
 * creation. Linear comment IDs identify individual prompts; an agent
 * session ID identifies the conversation. */
function externalThreadContext(
  provider: "slack" | "linear",
  adapters: { linear: LinearAdapter | null; slack: SlackAdapter | null },
  thread: Thread,
  message: Message
): ExternalThreadContext {
  if (provider === "slack") {
    return {
      externalThreadId: normalizeSlackDmThreadId(thread.id, message.id),
    }
  }

  const decoded = adapters.linear?.decodeThreadId(thread.id)
  if (!decoded?.agentSessionId) return { externalThreadId: thread.id }
  return {
    externalThreadId: linearAgentSessionThreadId(
      decoded.issueId,
      decoded.agentSessionId
    ),
    linearAgentSessionId: decoded.agentSessionId,
    linearIssueId: decoded.issueId,
  }
}

async function chatEventPayload(
  provider: "slack" | "linear",
  adapters: { linear: LinearAdapter | null; slack: SlackAdapter | null },
  message: Message,
  kind: "mention" | "follow_up",
  parsed: { presetOverride?: string; repoOverride?: string; text: string },
  threadContext: ExternalThreadContext
): Promise<IntegrationChatEventPayload> {
  const payload: IntegrationChatEventPayload = {
    authorName: message.author.fullName || message.author.userName,
    externalThreadId: threadContext.externalThreadId,
    kind,
    linearAgentSessionId: threadContext.linearAgentSessionId,
    linearIssueId: threadContext.linearIssueId,
    messageId: message.id,
    presetOverride: parsed.presetOverride,
    provider,
    repoOverride: parsed.repoOverride,
    text: parsed.text,
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
    const threadContext = externalThreadContext(
      provider,
      adapters,
      thread,
      message
    )
    const { externalThreadId } = threadContext

    if (parsed.control === "help") {
      await bot
        .thread(externalThreadId)
        .post({ markdown: INTEGRATION_HELP_MESSAGE })
        .catch(() => undefined)
      return
    }

    // Mute controls resolve inline: they need no run, and the confirmation
    // reaction doubles as the ack.
    if (parsed.control === "mute" || parsed.control === "unmute") {
      const muted = parsed.control === "mute"
      await convexClient().mutation(api.integrations.workerSetMuted, {
        externalThreadId,
        linearAgentSessionId: threadContext.linearAgentSessionId,
        linearOrganizationId:
          provider === "linear"
            ? linearRawOf(message)?.organizationId
            : undefined,
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

    // DM thread replies arrive unsubscribed and route back through
    // onNewMention; the bridge row turns them into follow-ups, so DM threads
    // need no subscription (and the threadless DM id cannot be subscribed).
    if (kind === "mention" && !thread.isDM) {
      await thread.subscribe().catch(() => undefined)
    }
    await acknowledge(provider, thread, message)

    const payload = await chatEventPayload(
      provider,
      adapters,
      message,
      kind,
      parsed,
      threadContext
    )
    await enqueueIntegrationEvent(payload, `${provider}:${kind}:${message.id}`)
  }

  bot.onNewMention(async (thread, message) => {
    await handleChatMessage(thread, message, "mention")
  })

  // Every DM message addresses the bot, so all DM traffic routes through the
  // mention path: the session bridge decides new-session vs follow-up. This
  // handler outranks subscription routing, so stale thread subscriptions
  // (from before DMs threaded per message) can never swallow a DM.
  bot.onDirectMessage(async (thread, message) => {
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
    const externalId = raw?.team_id ?? raw?.team
    if (!externalId) {
      console.warn("Ignoring Slack message without a workspace identity.")
      return
    }
    const matches = await convexClient().query(
      api.integrations.workerMatchSlackEvent,
      {
        channelId: thread.channelId,
        event: "keyword",
        externalId,
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
        externalId,
        externalThreadId: thread.id,
        kind: "slack_automation",
        messageId: message.id,
        messageText: message.text,
        provider: "slack",
      },
      `slack:keyword:${externalId}:${message.id}`
    )
  })

  bot.onReaction(async (event: ReactionEvent) => {
    if (!event.added || event.user.isBot === true || event.user.isMe) return
    if (providerOfThread(event.threadId) !== "slack") return

    // ReactionEvent does not expose Slack's outer webhook envelope, where
    // team_id lives. The route carries that authenticated workspace through
    // async request context. Never fall back to another tenant.
    const externalId = currentSlackWebhookTeamId()
    if (!externalId) {
      console.warn("Ignoring Slack reaction without a workspace identity.")
      return
    }

    const matches = await convexClient().query(
      api.integrations.workerMatchSlackEvent,
      {
        channelId: event.thread.channelId,
        emoji: event.rawEmoji,
        event: "reaction",
        externalId,
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
        externalId,
        externalThreadId: event.threadId,
        kind: "slack_automation",
        messageId: event.messageId,
        messageText: event.message?.text,
        provider: "slack",
      },
      `slack:reaction:${externalId}:${event.messageId}:${event.rawEmoji}:${event.user.userId}`
    )
  })
}
