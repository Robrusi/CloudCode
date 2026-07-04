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

export const REVIEW_AUTOFIX_ERROR = "autofix must be a boolean."

/** Whether runs also fix and push what they find; defaults to false. */
export function parseReviewAutofix(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === "boolean") return value
  throw new Error(REVIEW_AUTOFIX_ERROR)
}

/** Which PR authors a config reviews: everyone (unset), only the listed
 * logins ("allow"), or everyone except the listed logins ("block"). */
export const REVIEW_AUTHOR_FILTER_MODES = ["allow", "block"] as const
export type ReviewAuthorFilterMode = (typeof REVIEW_AUTHOR_FILTER_MODES)[number]

export const REVIEW_AUTHOR_FILTERS_MAX = 50
const GITHUB_LOGIN_MAX_LENGTH = 39

export const REVIEW_AUTHOR_FILTER_MODE_ERROR = `authorFilterMode must be one of ${REVIEW_AUTHOR_FILTER_MODES.join(", ")}.`
export const REVIEW_AUTHOR_FILTERS_ERROR = `authorFilters must be at most ${REVIEW_AUTHOR_FILTERS_MAX} GitHub usernames.`

export function parseReviewAuthorFilterMode(
  value: unknown
): ReviewAuthorFilterMode | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (
    typeof value === "string" &&
    (REVIEW_AUTHOR_FILTER_MODES as readonly string[]).includes(value)
  ) {
    return value as ReviewAuthorFilterMode
  }
  throw new Error(REVIEW_AUTHOR_FILTER_MODE_ERROR)
}

/** "@name" and "name" both mean the login "name". */
export function normalizeGitHubLogin(value: string) {
  return value.trim().replace(/^@/, "")
}

/** Normalized, deduped (case-insensitively) author login list. */
export function parseReviewAuthorFilters(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(REVIEW_AUTHOR_FILTERS_ERROR)

  const logins: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== "string") throw new Error(REVIEW_AUTHOR_FILTERS_ERROR)
    const login = normalizeGitHubLogin(entry)
    if (!login || login.length > GITHUB_LOGIN_MAX_LENGTH) continue
    const key = login.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    logins.push(login)
  }
  if (logins.length > REVIEW_AUTHOR_FILTERS_MAX) {
    throw new Error(REVIEW_AUTHOR_FILTERS_ERROR)
  }

  return logins
}

/** GitHub logins are case-insensitive. A missing author login only passes a
 * "block" filter — an allowlist cannot match what it cannot see. */
export function reviewAllowsAuthor(
  mode: ReviewAuthorFilterMode | undefined,
  authors: string[] | undefined,
  authorLogin: string | undefined
) {
  if (!mode || !authors?.length) return true
  const login = normalizeGitHubLogin(authorLogin ?? "").toLowerCase()
  const listed = Boolean(
    login && authors.some((author) => author.toLowerCase() === login)
  )
  return mode === "allow" ? listed : !listed
}
