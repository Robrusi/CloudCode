// Fallback shown when a Codex run fails on usage limits but no readable message
// is available. Codex normally supplies its own text (see summarize below).
export const CODEX_USAGE_LIMIT_MESSAGE = "You've hit your usage limit."

// Lowercased substrings that identify a Codex usage / quota exhaustion error.
// `usagelimitexceeded` is the structured `codexErrorInfo` discriminant emitted
// on the turn error; the rest cover the human-readable `message` and the raw
// provider `additionalDetails` payloads. Transient `rate_limit_reached` signals
// are deliberately excluded: those are short retry windows, not "out of usage".
const CODEX_USAGE_LIMIT_PATTERNS = [
  "usagelimitexceeded",
  "usage_limit_reached",
  "usage limit reached",
  "reached your usage limit",
  "hit your usage limit",
  "credits_depleted",
  "credits depleted",
]

export function isCodexUsageLimitError(value: unknown) {
  const text =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : ""
  if (!text) return false
  const normalized = text.toLowerCase()

  return CODEX_USAGE_LIMIT_PATTERNS.some((pattern) =>
    normalized.includes(pattern)
  )
}

// Reduce Codex's usage-limit message to its useful parts: the limit statement
// and any "try again at …" hint. Strips ChatGPT upgrade/credit URLs and the
// upsell clause, and never echoes a raw JSON payload back to the user. Idempotent
// so it can run again at the surfacing chokepoint without duplicating the hint.
export function summarizeCodexUsageLimitError(message: string) {
  const withoutUrls = (text: string) =>
    text
      .replace(/\s*\(https?:\/\/[^)]*\)/gi, "")
      .replace(/https?:\/\/\S+/gi, "")

  const rawLead = message.split(/\b(?:upgrade|visit|try again)\b/i)[0] ?? ""
  const lead = withoutUrls(rawLead)
    .replace(/\s+/g, " ")
    .replace(/[,\s]+$/, "")
    .trim()
  const leadIsUsable =
    Boolean(lead) &&
    lead.length <= 160 &&
    !lead.includes("{") &&
    !lead.includes('"')
  const base = leadIsUsable ? lead : CODEX_USAGE_LIMIT_MESSAGE
  const withPeriod = /[.!?]$/.test(base) ? base : `${base}.`

  const retryMatch = message.match(/\btry again\b[^.{}"]*/i)?.[0]?.trim()
  const retry = retryMatch && retryMatch.length <= 60 ? retryMatch : ""
  if (!retry) return withPeriod

  const retryText = retry.charAt(0).toUpperCase() + retry.slice(1)
  return `${withPeriod} ${retryText}.`
}

// Collapse any raw Codex usage-limit error string to its minimal user-facing
// summary, leaving every other error untouched.
export function normalizeCodexUsageLimitError(value: string) {
  return isCodexUsageLimitError(value)
    ? summarizeCodexUsageLimitError(value)
    : value
}
