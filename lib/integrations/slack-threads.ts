export type SlackThreadParts = {
  channel: string
  threadTs?: string
}

/** Parses both current thread ids (slack:C…:ts) and legacy channel-only ids
 * (slack:D…). Keeping this logic shared prevents inbound and outbound paths
 * from disagreeing about whether an empty timestamp is a real thread. */
export function slackThreadParts(threadId: string): SlackThreadParts {
  const [provider, channel, rawThreadTs, ...extra] = threadId.split(":")
  if (provider !== "slack" || !channel || extra.length > 0) {
    throw new Error(`Invalid Slack thread ID: ${threadId}`)
  }
  return { channel, threadTs: rawThreadTs || undefined }
}

/** Slack's adapter gives top-level DMs the shared id `slack:D…:`. CloudCode
 * treats each top-level DM as its own session, so pin that id to the incoming
 * message timestamp. Replies already carry their root timestamp unchanged. */
export function normalizeSlackDmThreadId(
  threadId: string,
  messageId: string
): string {
  const { channel, threadTs } = slackThreadParts(threadId)
  if (!channel.startsWith("D") || threadTs || !messageId) return threadId
  return `slack:${channel}:${messageId}`
}

/** Removes Slack's native markup for this bot while preserving mentions of
 * other people. Slack sends `@bot` mentions as `<@U…>` rather than the bot's
 * display name. */
export function stripSlackBotMention(text: string, botUserId?: string) {
  if (!botUserId) return text
  const escapedId = botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text.replace(new RegExp(`<@${escapedId}(?:\\|[^>]+)?>`, "gi"), " ")
}
