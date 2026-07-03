import {
  nextRunAtAfter,
  validateAutomationCron,
} from "@/lib/automations/schedule"

/**
 * Structured schedule editor state. Every draft round-trips to a cron
 * expression for storage. The editor renders raw cron only in "Custom" mode,
 * which losslessly holds any expression the structured kinds cannot express.
 */
export type ScheduleDraft =
  | { kind: "hourly"; every: number; minute: number }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; days: number[]; time: string }
  | { kind: "custom"; cron: string }

export type ScheduleKind = ScheduleDraft["kind"]

/**
 * Frequency choices in the editor's dropdown. "weekdays" and "weekly" are two
 * entry points into the same weekly kind (the Mon-Fri preset vs. custom days);
 * the rest map one-to-one onto a kind.
 */
export const FREQUENCY_OPTIONS = [
  "hourly",
  "daily",
  "weekdays",
  "weekly",
  "custom",
] as const
export type FrequencyOption = (typeof FREQUENCY_OPTIONS)[number]

export const FREQUENCY_LABEL: Record<FrequencyOption, string> = {
  custom: "Custom",
  daily: "Daily",
  hourly: "Hourly",
  weekdays: "Weekdays",
  weekly: "Weekly",
}

/** Hour intervals offered by the editor; other stored values still render. */
export const HOURLY_INTERVALS = [1, 2, 3, 4, 6, 8, 12]

export const WEEKDAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"]
export const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

const WEEKDAYS = [1, 2, 3, 4, 5]
const WEEKEND = [0, 6]

const DEFAULT_TIME = "09:00"
const DEFAULT_CRON = "0 9 * * *"

export function parseTimeOfDay(time: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return undefined

  return { hour, minute }
}

function normalizedDays(days: number[]) {
  return [...new Set(days)]
    .filter((day) => day >= 0 && day <= 6)
    .sort((a, b) => a - b)
}

function sameDays(a: number[], b: number[]) {
  return a.length === b.length && a.every((day, index) => day === b[index])
}

export function ordinalDay(day: number) {
  const rem10 = day % 10
  const rem100 = day % 100
  const suffix =
    rem100 >= 11 && rem100 <= 13
      ? "th"
      : rem10 === 1
        ? "st"
        : rem10 === 2
          ? "nd"
          : rem10 === 3
            ? "rd"
            : "th"

  return `${day}${suffix}`
}

const pad2 = (value: number) => String(value).padStart(2, "0")

/** Reads HH:MM from a cron whose minute and hour are plain numbers. */
function timeFromCron(cron: string): string | undefined {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return undefined
  const [minute, hour] = fields
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return undefined
  const time = parseTimeOfDay(`${hour}:${pad2(Number(minute))}`)
  return time ? `${pad2(time.hour)}:${pad2(time.minute)}` : undefined
}

/** Best-effort time of day carried across frequency switches. */
function timeOfDraft(draft: ScheduleDraft): string {
  switch (draft.kind) {
    case "daily":
    case "weekly":
      return draft.time
    case "hourly":
      return `09:${pad2(draft.minute)}`
    case "custom":
      return timeFromCron(draft.cron) ?? DEFAULT_TIME
  }
}

export function cronFromScheduleDraft(draft: ScheduleDraft): string {
  if (draft.kind === "custom") return validateAutomationCron(draft.cron)

  if (draft.kind === "hourly") {
    if (
      !Number.isInteger(draft.minute) ||
      draft.minute < 0 ||
      draft.minute > 59
    ) {
      throw new Error("Pick a valid minute of the hour.")
    }
    if (!Number.isInteger(draft.every) || draft.every < 1 || draft.every > 23) {
      throw new Error("Pick a valid hour interval.")
    }
    const hour = draft.every === 1 ? "*" : `*/${draft.every}`
    return `${draft.minute} ${hour} * * *`
  }

  const time = parseTimeOfDay(draft.time)
  if (!time) throw new Error("Pick a valid time of day.")
  const base = `${time.minute} ${time.hour}`

  switch (draft.kind) {
    case "daily":
      return `${base} * * *`
    case "weekly": {
      const days = normalizedDays(draft.days)
      if (days.length === 0) throw new Error("Pick at least one day.")
      if (days.length === 7) return `${base} * * *`
      return `${base} * * ${days.join(",")}`
    }
  }
}

/** The hourly/daily/weekly subset a cron maps onto, or null when it does not. */
function structuredFromCron(cron: string): ScheduleDraft | null {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return null

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  if (month !== "*" || !/^\d{1,2}$/.test(minute) || Number(minute) > 59) {
    return null
  }

  if (dayOfMonth === "*" && dayOfWeek === "*") {
    if (hour === "*") {
      return { every: 1, kind: "hourly", minute: Number(minute) }
    }
    const interval = /^\*\/(\d{1,2})$/.exec(hour)
    if (interval) {
      const every = Number(interval[1])
      if (every >= 1 && every <= 23) {
        return { every, kind: "hourly", minute: Number(minute) }
      }
      return null
    }
  }

  if (!/^\d{1,2}$/.test(hour) || Number(hour) > 23) return null
  const time = `${pad2(Number(hour))}:${pad2(Number(minute))}`

  if (dayOfMonth === "*" && dayOfWeek === "*") return { kind: "daily", time }
  if (dayOfMonth === "*" && dayOfWeek === "1-5") {
    return { days: [...WEEKDAYS], kind: "weekly", time }
  }
  if (dayOfMonth === "*" && /^\d(,\d)*$/.test(dayOfWeek)) {
    const days = normalizedDays(
      dayOfWeek.split(",").map((day) => Number(day) % 7)
    )
    return { days, kind: "weekly", time }
  }

  return null
}

/** Maps a stored cron onto the editor. Anything the structured kinds cannot
 * represent (monthly, ranges, step minutes) opens losslessly as "Custom". */
export function scheduleDraftFromCron(cron: string): ScheduleDraft {
  return structuredFromCron(cron) ?? { cron: cron.trim(), kind: "custom" }
}

/** Which dropdown option a draft currently reads as. */
export function frequencyOfSchedule(draft: ScheduleDraft): FrequencyOption {
  switch (draft.kind) {
    case "hourly":
      return "hourly"
    case "daily":
      return "daily"
    case "custom":
      return "custom"
    case "weekly":
      return sameDays(normalizedDays(draft.days), WEEKDAYS)
        ? "weekdays"
        : "weekly"
  }
}

function safeCronOfDraft(draft: ScheduleDraft): string {
  try {
    return cronFromScheduleDraft(draft)
  } catch {
    return DEFAULT_CRON
  }
}

/**
 * The draft produced by choosing a frequency, carrying the time of day (and
 * hour interval) forward so a switch never silently discards a picked value.
 */
export function scheduleForFrequency(
  option: FrequencyOption,
  current: ScheduleDraft
): ScheduleDraft {
  const time = timeOfDraft(current)
  switch (option) {
    case "hourly":
      return {
        every: current.kind === "hourly" ? current.every : 1,
        kind: "hourly",
        minute: parseTimeOfDay(time)?.minute ?? 0,
      }
    case "daily":
      return { kind: "daily", time }
    case "weekdays":
      return { days: [...WEEKDAYS], kind: "weekly", time }
    case "weekly": {
      // Keep custom days when leaving anything but the weekdays preset,
      // otherwise start from a single day so it still reads as "Weekly".
      const keep =
        current.kind === "weekly" &&
        !sameDays(normalizedDays(current.days), WEEKDAYS)
      return { days: keep ? current.days : [1], kind: "weekly", time }
    }
    case "custom":
      return { cron: safeCronOfDraft(current), kind: "custom" }
  }
}

function weeklyDaysLabel(days: number[]) {
  const normalized = normalizedDays(days)
  if (normalized.length === 7) return "Every day"
  if (sameDays(normalized, WEEKDAYS)) return "Weekdays"
  if (sameDays(normalized, WEEKEND)) return "Weekends"
  return normalized.map((day) => WEEKDAY_LONG[day].slice(0, 3)).join(", ")
}

/** Recognizes a "day of month" cron for friendly display of Custom schedules. */
function monthlyFromCron(cron: string) {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  if (month !== "*" || dayOfWeek !== "*") return null
  if (
    !/^\d{1,2}$/.test(minute) ||
    !/^\d{1,2}$/.test(hour) ||
    !/^\d{1,2}$/.test(dayOfMonth)
  ) {
    return null
  }
  const min = Number(minute)
  const hr = Number(hour)
  const day = Number(dayOfMonth)
  if (min > 59 || hr > 23 || day < 1 || day > 31) return null
  return { day, time: `${pad2(hr)}:${pad2(min)}` }
}

/** Friendly one-line description of a raw cron used in "Custom" mode. */
export function humanizeCron(cron: string): string {
  const monthly = monthlyFromCron(cron)
  if (monthly) {
    return `The ${ordinalDay(monthly.day)} of every month at ${monthly.time}`
  }
  return `Custom · ${cron.trim()}`
}

/** Compact list-row label: "Hourly", "Every 6h", "Weekdays 09:00". */
export function shortScheduleLabel(draft: ScheduleDraft): string {
  switch (draft.kind) {
    case "hourly":
      return draft.every === 1 ? "Hourly" : `Every ${draft.every}h`
    case "daily":
      return `Daily ${draft.time}`
    case "weekly": {
      if (draft.days.length === 0) return "Pick days"
      return `${weeklyDaysLabel(draft.days)} ${draft.time}`
    }
    case "custom": {
      const monthly = monthlyFromCron(draft.cron)
      return monthly
        ? `Monthly ${ordinalDay(monthly.day)} · ${monthly.time}`
        : draft.cron
    }
  }
}

export function describeScheduleDraft(draft: ScheduleDraft): string {
  switch (draft.kind) {
    case "hourly": {
      const base =
        draft.every === 1 ? "Every hour" : `Every ${draft.every} hours`
      return draft.minute === 0 ? base : `${base} at :${pad2(draft.minute)}`
    }
    case "daily":
      return `Every day at ${draft.time}`
    case "weekly": {
      if (draft.days.length === 0) return "Pick at least one day"
      const label = weeklyDaysLabel(draft.days)
      return label === "Every day"
        ? `Every day at ${draft.time}`
        : `${label} at ${draft.time}`
    }
    case "custom":
      return humanizeCron(draft.cron)
  }
}

/** Next `count` fire times, for the "next runs" preview under the editor. */
export function upcomingRuns(
  cron: string,
  timezone: string,
  count: number,
  fromMs: number
): number[] {
  const runs: number[] = []
  let cursor = fromMs
  for (let index = 0; index < count; index += 1) {
    cursor = nextRunAtAfter(cron, timezone, cursor)
    runs.push(cursor)
  }

  return runs
}
