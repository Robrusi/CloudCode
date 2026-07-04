export const REVIEW_MAX_CONSECUTIVE_FAILURES = 3

export const REVIEW_NAME_MAX_LENGTH = 120
export const REVIEW_PROMPT_MAX_LENGTH = 20_000

export const REVIEW_NAME_ERROR = `name is required and must be at most ${REVIEW_NAME_MAX_LENGTH} characters.`
export const REVIEW_PROMPT_ERROR = `prompt must be at most ${REVIEW_PROMPT_MAX_LENGTH} characters.`
export const REVIEW_AUTO_ENVIRONMENT_ERROR =
  "autoEnvironment must be a boolean."
export const REVIEW_READY_FOR_REVIEW_ERROR =
  "reviewReadyForReview must be a boolean."

export function parseReviewName(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : ""
  if (!normalized || normalized.length > REVIEW_NAME_MAX_LENGTH) {
    throw new Error(REVIEW_NAME_ERROR)
  }

  return normalized
}

/** Empty means the built-in review prompt template. */
export function parseReviewPrompt(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : ""
  if (!normalized) return undefined
  if (normalized.length > REVIEW_PROMPT_MAX_LENGTH) {
    throw new Error(REVIEW_PROMPT_ERROR)
  }

  return normalized
}

/** Whether runs set up the auto environment; defaults to true. */
export function parseReviewAutoEnvironment(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === "boolean") return value
  throw new Error(REVIEW_AUTO_ENVIRONMENT_ERROR)
}

/** Whether drafts marked ready also trigger a review; defaults to false. */
export function parseReviewReadyForReview(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === "boolean") return value
  throw new Error(REVIEW_READY_FOR_REVIEW_ERROR)
}
