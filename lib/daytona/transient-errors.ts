/**
 * Classifies errors from Daytona API calls (axios-based SDK) that are safe to
 * retry for read-only or idempotent requests: gateway/availability statuses
 * and low-level network failures. Anything else — auth errors, 404s,
 * validation errors — must surface immediately.
 */

const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])

const TRANSIENT_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "EPIPE",
  "ERR_NETWORK",
  "ETIMEDOUT",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object")
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function isTransientDaytonaApiError(error: unknown): boolean {
  if (!isRecord(error)) return false

  const status =
    numberValue(error.status) ??
    numberValue(error.statusCode) ??
    numberValue(isRecord(error.response) ? error.response.status : undefined)
  if (status !== undefined) return TRANSIENT_STATUS_CODES.has(status)

  if (typeof error.code === "string" && TRANSIENT_ERROR_CODES.has(error.code)) {
    return true
  }

  const message = typeof error.message === "string" ? error.message : ""
  return /request failed with status code (?:408|429|5\d\d)/i.test(message)
}
