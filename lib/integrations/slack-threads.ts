export type SlackThreadParts = {
  channel: string
  threadTs?: string
}

export type SlackThreadContextMessage = {
  authorName: string
  text: string
}

type SlackThreadMessage = {
  author: {
    fullName: string
    userName: string
  }
  id: string
  text: string
}

const SLACK_THREAD_CONTEXT_CHARACTER_LIMIT = 12_000

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

/** Builds bounded, chronological context from the messages preceding the
 * request. Keeping the limit here prevents a busy Slack thread from turning
 * into an unbounded run prompt. */
export function slackThreadContextFromMessages(
  messages: readonly SlackThreadMessage[],
  currentMessageId: string,
  botUserId?: string
): SlackThreadContextMessage[] {
  const context = messages
    .filter((message) => message.id !== currentMessageId)
    .map((message) => ({
      authorName: message.author.fullName || message.author.userName,
      text: stripSlackBotMention(message.text, botUserId).trim(),
    }))
    .filter((message) => message.text)

  let remaining = SLACK_THREAD_CONTEXT_CHARACTER_LIMIT
  const selected: SlackThreadContextMessage[] = []
  for (let index = context.length - 1; index >= 0; index -= 1) {
    const message = context[index]
    if (message.text.length > remaining) {
      if (selected.length === 0 && remaining > 0) {
        selected.push({
          ...message,
          text: message.text.slice(-remaining),
        })
      }
      break
    }
    selected.push(message)
    remaining -= message.text.length
  }

  return selected.reverse()
}
