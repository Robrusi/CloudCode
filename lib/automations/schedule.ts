import { CronExpressionParser } from "cron-parser"

export const AUTOMATION_CRON_ERROR =
  "cron must be a valid 5-field cron expression (minute hour day-of-month month day-of-week)."
export const AUTOMATION_TIMEZONE_ERROR =
  "timezone must be a valid IANA time zone."

const CRON_FIELD_COUNT = 5

export function validateAutomationCron(cron: unknown): string {
  const normalized =
    typeof cron === "string" ? cron.trim().replace(/\s+/g, " ") : ""
  if (
    !normalized ||
    normalized.split(" ").length !== CRON_FIELD_COUNT ||
    !safeParseCron(normalized)
  ) {
    throw new Error(AUTOMATION_CRON_ERROR)
  }

  return normalized
}

export function validateAutomationTimezone(timezone: unknown): string {
  const normalized = typeof timezone === "string" ? timezone.trim() : ""
  if (!normalized) throw new Error(AUTOMATION_TIMEZONE_ERROR)

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized })
  } catch {
    throw new Error(AUTOMATION_TIMEZONE_ERROR)
  }

  return normalized
}

// Next fire time strictly after afterMs. Always computed from the caller's
// "now" so slots missed during downtime are skipped, never backfilled.
export function nextRunAtAfter(
  cron: string,
  timezone: string,
  afterMs: number
): number {
  return CronExpressionParser.parse(cron, {
    currentDate: new Date(afterMs),
    tz: timezone,
  })
    .next()
    .getTime()
}

function safeParseCron(cron: string) {
  try {
    CronExpressionParser.parse(cron)
    return true
  } catch {
    return false
  }
}
