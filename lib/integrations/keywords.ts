/** Inline controls in messages addressed to the bot, Devin-style:
 *
 *   @cloudcode !repo=owner/name fix the flaky auth test
 *   @cloudcode mute
 *
 * Control words only count when they are the entire instruction, so a task
 * that merely contains the word "stop" never cancels anything. */

const REPO_KEYWORD_RE = /(?:^|\s)!repo=(\S+)/i

export type ParsedIntegrationMessage = {
  control: "mute" | "unmute" | null
  repoOverride?: string
  text: string
}

/** Expands !repo shorthand to the canonical GitHub URL form used across the
 * app; returns undefined for values that are neither a GitHub URL nor an
 * owner/name pair. */
function repoUrlFromKeyword(value: string): string | undefined {
  const trimmed = value.trim().replace(/\.git$/, "")
  const urlMatch = trimmed.match(
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/i
  )
  if (urlMatch) return `https://github.com/${urlMatch[1]}/${urlMatch[2]}.git`
  const shortMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (shortMatch)
    return `https://github.com/${shortMatch[1]}/${shortMatch[2]}.git`
  return undefined
}

/** Strips the bot mention and inline keywords out of a message, returning
 * the clean instruction text plus any parsed controls. */
export function parseIntegrationMessage(
  rawText: string,
  botUserName: string
): ParsedIntegrationMessage {
  let text = rawText.trim()

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

  text = text.replace(/\s+/g, " ").trim()

  const lowered = text.toLowerCase()
  if (lowered === "mute") return { control: "mute", repoOverride, text: "" }
  if (lowered === "unmute") {
    return { control: "unmute", repoOverride, text: "" }
  }

  return { control: null, repoOverride, text }
}
