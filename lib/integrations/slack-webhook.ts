import { createHmac, timingSafeEqual } from "node:crypto"

const SLACK_WEBHOOK_REPLAY_WINDOW_SECONDS = 5 * 60

type SlackEventEnvelope = {
  api_app_id?: unknown
  event?: {
    app_id?: unknown
    bot_id?: unknown
    channel?: unknown
    item?: { channel?: unknown; ts?: unknown; type?: unknown }
    reaction?: unknown
    subtype?: unknown
    team?: unknown
    team_id?: unknown
    text?: unknown
    thread_ts?: unknown
    ts?: unknown
    type?: unknown
    user?: unknown
  }
  event_id?: unknown
  team_id?: unknown
  type?: unknown
}

export type SlackAutomationWebhookEvent = {
  actorUserId: string
  channelId: string
  emoji?: string
  event: "keyword" | "reaction"
  eventId?: string
  externalId: string
  externalThreadId: string
  messageId: string
  messageText?: string
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

export function verifySlackWebhookRequest(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  signingSecret: string,
  now = Date.now()
) {
  const timestamp = Number(timestampHeader)
  if (
    !signatureHeader ||
    !Number.isFinite(timestamp) ||
    Math.abs(Math.floor(now / 1000) - timestamp) >
      SLACK_WEBHOOK_REPLAY_WINDOW_SECONDS
  ) {
    return false
  }

  const expected = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestampHeader}:${rawBody}`)
    .digest("hex")}`
  const provided = Buffer.from(signatureHeader)
  const computed = Buffer.from(expected)
  return (
    provided.length === computed.length && timingSafeEqual(provided, computed)
  )
}

/** Extracts the Slack events that can drive factory waits: human messages
 * (including DMs — ask_human questions posted to a bridged DM must still be
 * answerable) and reactions. Chat mentions, bot messages, edits, removals,
 * and non-message reactions remain owned by the Chat SDK path. */
export function parseSlackWaitWebhookEvent(
  value: unknown
): SlackAutomationWebhookEvent | null {
  if (!value || typeof value !== "object") return null
  const envelope = value as SlackEventEnvelope
  if (envelope.type !== "event_callback" || !envelope.event) return null

  const event = envelope.event
  const externalId =
    stringValue(envelope.team_id) ??
    stringValue(event.team_id) ??
    stringValue(event.team)
  const eventId = stringValue(envelope.event_id)
  const actorUserId = stringValue(event.user)
  if (!externalId || !actorUserId) return null

  if (event.type === "message") {
    const channelId = stringValue(event.channel)
    const messageId = stringValue(event.ts)
    const messageText = stringValue(event.text)
    if (
      !channelId ||
      !messageId ||
      !messageText ||
      event.subtype !== undefined ||
      event.bot_id !== undefined ||
      (event.app_id !== undefined && event.app_id === envelope.api_app_id)
    ) {
      return null
    }
    const threadTs = stringValue(event.thread_ts) ?? messageId
    return {
      actorUserId,
      channelId,
      event: "keyword",
      eventId,
      externalId,
      externalThreadId: `slack:${channelId}:${threadTs}`,
      messageId,
      messageText,
    }
  }

  if (event.type !== "reaction_added" || event.item?.type !== "message") {
    return null
  }
  const channelId = stringValue(event.item.channel)
  const messageId = stringValue(event.item.ts)
  const emoji = stringValue(event.reaction)
  if (!channelId || !messageId || !emoji) return null
  return {
    actorUserId,
    channelId,
    emoji,
    event: "reaction",
    eventId,
    externalId,
    externalThreadId: `slack:${channelId}:${messageId}`,
    messageId,
  }
}

/** DM messages never drive channel automations; they stay owned by the Chat
 * SDK session path. Factory waits still see them. */
export function isSlackAutomationEligibleEvent(
  event: SlackAutomationWebhookEvent
) {
  return !(event.event === "keyword" && event.channelId.startsWith("D"))
}

/** Extracts only the Slack events that can drive automations: the wait
 * events minus DM messages. */
export function parseSlackAutomationWebhookEvent(
  value: unknown
): SlackAutomationWebhookEvent | null {
  const parsed = parseSlackWaitWebhookEvent(value)
  return parsed && isSlackAutomationEligibleEvent(parsed) ? parsed : null
}
