export const AUTOMATION_MAX_CONSECUTIVE_FAILURES = 3

export const AUTOMATION_NAME_MAX_LENGTH = 120
export const AUTOMATION_PROMPT_MAX_LENGTH = 20_000

/** What happens to a run's sandbox when the run finishes. */
export const AUTOMATION_SANDBOX_RETENTIONS = ["delete", "idle"] as const
export type AutomationSandboxRetention =
  (typeof AUTOMATION_SANDBOX_RETENTIONS)[number]
export const AUTOMATION_SANDBOX_RETENTION_DEFAULT: AutomationSandboxRetention =
  "delete"

/** Whether runs share the automation's chat or each open their own. */
export const AUTOMATION_THREAD_MODES = ["single", "per-run"] as const
export type AutomationThreadMode = (typeof AUTOMATION_THREAD_MODES)[number]
export const AUTOMATION_THREAD_MODE_DEFAULT: AutomationThreadMode = "single"

export const AUTOMATION_SANDBOX_RETENTION_ERROR = `sandboxRetention must be one of ${AUTOMATION_SANDBOX_RETENTIONS.join(", ")}.`
export const AUTOMATION_THREAD_MODE_ERROR = `threadMode must be one of ${AUTOMATION_THREAD_MODES.join(", ")}.`
export const AUTOMATION_AUTO_ENVIRONMENT_ERROR =
  "autoEnvironment must be a boolean."

/** Whether runs set up the auto environment; defaults to true. */
export function parseAutomationAutoEnvironment(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === "boolean") return value
  throw new Error(AUTOMATION_AUTO_ENVIRONMENT_ERROR)
}

export function parseAutomationSandboxRetention(
  value: unknown
): AutomationSandboxRetention {
  if (value === undefined || value === null) {
    return AUTOMATION_SANDBOX_RETENTION_DEFAULT
  }
  if (
    typeof value === "string" &&
    (AUTOMATION_SANDBOX_RETENTIONS as readonly string[]).includes(value)
  ) {
    return value as AutomationSandboxRetention
  }
  throw new Error(AUTOMATION_SANDBOX_RETENTION_ERROR)
}

export function parseAutomationThreadMode(
  value: unknown
): AutomationThreadMode {
  if (value === undefined || value === null) {
    return AUTOMATION_THREAD_MODE_DEFAULT
  }
  if (
    typeof value === "string" &&
    (AUTOMATION_THREAD_MODES as readonly string[]).includes(value)
  ) {
    return value as AutomationThreadMode
  }
  throw new Error(AUTOMATION_THREAD_MODE_ERROR)
}

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
