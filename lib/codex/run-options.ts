const CODEX_REASONING_EFFORTS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
] as const

export const CODEX_REASONING_EFFORT_ERROR =
  "reasoningEffort must be none, low, medium, high, or xhigh."

export type ReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number]

const CODEX_SPEEDS = ["standard", "fast"] as const

export const CODEX_SPEED_ERROR = "speed must be standard or fast."

export type CodexSpeed = (typeof CODEX_SPEEDS)[number]

export function parseCodexReasoningEffort(
  value: unknown
): ReasoningEffort | undefined {
  return typeof value === "string" &&
    (CODEX_REASONING_EFFORTS as readonly string[]).includes(value)
    ? (value as ReasoningEffort)
    : undefined
}

export function parseCodexReasoningEffortOrThrow(
  effort?: string
): ReasoningEffort | undefined {
  const parsed = parseCodexReasoningEffort(effort)
  if (parsed || !effort) return parsed

  throw new Error(CODEX_REASONING_EFFORT_ERROR)
}

export function parseCodexSpeed(value: unknown): CodexSpeed | undefined {
  return typeof value === "string" &&
    (CODEX_SPEEDS as readonly string[]).includes(value)
    ? (value as CodexSpeed)
    : undefined
}

export function parseCodexSpeedOrThrow(speed?: string): CodexSpeed {
  if (!speed) return "standard"

  const parsed = parseCodexSpeed(speed)
  if (parsed) return parsed

  throw new Error(CODEX_SPEED_ERROR)
}
