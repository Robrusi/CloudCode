export const AUTOMATION_MAX_CONSECUTIVE_FAILURES = 3

export const AUTOMATION_NAME_MAX_LENGTH = 120
export const AUTOMATION_PROMPT_MAX_LENGTH = 20_000

export const AUTOMATION_NAME_ERROR = `name is required and must be at most ${AUTOMATION_NAME_MAX_LENGTH} characters.`
export const AUTOMATION_PROMPT_ERROR = `prompt is required and must be at most ${AUTOMATION_PROMPT_MAX_LENGTH} characters.`

export function parseAutomationName(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : ""
  if (!normalized || normalized.length > AUTOMATION_NAME_MAX_LENGTH) {
    throw new Error(AUTOMATION_NAME_ERROR)
  }

  return normalized
}

export function parseAutomationTaskPrompt(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : ""
  if (!normalized || normalized.length > AUTOMATION_PROMPT_MAX_LENGTH) {
    throw new Error(AUTOMATION_PROMPT_ERROR)
  }

  return normalized
}
