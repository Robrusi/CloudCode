// User-facing message shown when a Codex run fails because the account has run
// out of usage. Kept intentionally minimal: the raw provider payload (a large
// JSON blob) must never reach the user.
export const CODEX_USAGE_LIMIT_MESSAGE = "You're out of Codex usage."

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

// Collapse any raw Codex usage-limit error string to the minimal user-facing
// message, leaving every other error untouched.
export function normalizeCodexUsageLimitError(value: string) {
  return isCodexUsageLimitError(value) ? CODEX_USAGE_LIMIT_MESSAGE : value
}
