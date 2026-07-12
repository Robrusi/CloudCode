/** Inline controls in messages addressed to the bot, Devin-style:
 *
 *   @cloudcode !repo=owner/name fix the flaky auth test
 *   @cloudcode !preset="node 20" run the benchmarks
 *   @cloudcode mute
 *
 * Control words only count when they are the entire instruction, so a task
 * that merely contains the word "help" never triggers anything. */

import { canonicalGitHubRepoUrl } from "@/lib/github/repo"
import { stripSlackBotMention } from "@/lib/integrations/slack-threads"

const REPO_KEYWORD_RE = /(?:^|\s)!repo=(\S+)/i
// Preset names may contain spaces; accept a quoted value or a bare token.
const PRESET_KEYWORD_RE = /(?:^|\s)!preset=(?:"([^"]+)"|“([^”]+)”|(\S+))/i

export type ParsedIntegrationMessage = {
  control: "help" | "mute" | "unmute" | null
  presetOverride?: string
  repoOverride?: string
  text: string
}

/** Expands !repo shorthand to the canonical GitHub URL form used across the
 * app; returns undefined for values that are neither a GitHub URL nor an
 * owner/name pair. */
function repoUrlFromKeyword(value: string): string | undefined {
  const trimmed = value.trim()
  const shortMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)
  const candidate =
    !trimmed.includes("://") && shortMatch
      ? `https://github.com/${shortMatch[1]}/${shortMatch[2]}`
      : trimmed
  return canonicalGitHubRepoUrl(candidate) ?? undefined
}

/** Strips the bot mention and inline keywords out of a message, returning
 * the clean instruction text plus any parsed controls. */
export function parseIntegrationMessage(
  rawText: string,
  botUserName: string,
  botUserId?: string
): ParsedIntegrationMessage {
  let text = rawText.trim()

  // Slack uses the bot's opaque user ID in native mention markup.
  text = stripSlackBotMention(text, botUserId)

  // The mention can appear anywhere; remove the @botname token itself.
  const mentionRe = new RegExp(
    `@${botUserName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "gi"
  )
  text = text.replace(mentionRe, " ")

  let repoOverride: string | undefined
  const repoMatch = text.match(REPO_KEYWORD_RE)
  if (repoMatch) {
    repoOverride = repoUrlFromKeyword(repoMatch[1])
    text = text.replace(REPO_KEYWORD_RE, " ")
  }

  let presetOverride: string | undefined
  const presetMatch = text.match(PRESET_KEYWORD_RE)
  if (presetMatch) {
    presetOverride =
      (presetMatch[1] ?? presetMatch[2] ?? presetMatch[3])?.trim() || undefined
    text = text.replace(PRESET_KEYWORD_RE, " ")
  }

  text = text.replace(/\s+/g, " ").trim()

  const lowered = text.toLowerCase()
  if (lowered === "mute") {
    return { control: "mute", presetOverride, repoOverride, text: "" }
  }
  if (lowered === "unmute") {
    return { control: "unmute", presetOverride, repoOverride, text: "" }
  }
  if (lowered === "help" || lowered === "commands") {
    return { control: "help", presetOverride, repoOverride, text: "" }
  }

  return { control: null, presetOverride, repoOverride, text }
}

export const INTEGRATION_HELP_MESSAGE = [
  "*Commands*",
  "• `!repo=owner/name` — run against a specific repository",
  '• `!preset=name` (or `!preset="name with spaces"`, `!preset=auto`) — pick the sandbox preset for a new session',
  "• `mute` / `unmute` — pause or resume follow-ups in this thread",
  "",
  "Mention me with a task to start a session, reply in the thread to follow up, or DM me directly.",
].join("\n")
