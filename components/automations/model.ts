import type { Doc } from "@/convex/_generated/dataModel"
import type { Model, Speed, Thinking } from "@/lib/chat/options"
import type { BranchMode } from "@/lib/codex/branch-names"
import {
  AUTOMATION_SANDBOX_RETENTION_DEFAULT,
  AUTOMATION_THREAD_MODE_DEFAULT,
  type AutomationSandboxRetention,
  type AutomationThreadMode,
} from "@/lib/automations/config"
import {
  cronFromScheduleDraft,
  scheduleDraftFromCron,
  type ScheduleDraft,
} from "@/lib/automations/schedule-draft"

export type AutomationRecord = Doc<"automations">

export type AutomationRunStatus = NonNullable<AutomationRecord["lastRunStatus"]>

export const AUTOMATION_STATUS_LABEL: Record<AutomationRunStatus, string> = {
  canceled: "Canceled",
  dispatch_failed: "Failed to start",
  failed: "Failed",
  running: "Running",
  skipped: "Skipped",
  succeeded: "Succeeded",
}

export type AutomationDraft = {
  autoEnvironment: boolean
  baseBranch: string
  branchMode: BranchMode
  branchName: string
  model: Model
  name: string
  prompt: string
  reasoningEffort: Thinking
  repoUrl: string
  sandboxPresetId: string
  sandboxRetention: AutomationSandboxRetention
  schedule: ScheduleDraft
  speed: Speed
  threadMode: AutomationThreadMode
  timezone: string
}

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

export function timezoneOptions() {
  try {
    return Intl.supportedValuesOf("timeZone")
  } catch {
    return ["UTC"]
  }
}

export function emptyAutomationDraft(): AutomationDraft {
  return {
    autoEnvironment: true,
    baseBranch: "",
    branchMode: "auto",
    branchName: "",
    model: "gpt-5.5",
    name: "",
    prompt: "",
    reasoningEffort: "medium",
    repoUrl: "",
    sandboxPresetId: "",
    sandboxRetention: AUTOMATION_SANDBOX_RETENTION_DEFAULT,
    schedule: { kind: "daily", time: "09:00" },
    speed: "standard",
    threadMode: AUTOMATION_THREAD_MODE_DEFAULT,
    timezone: browserTimezone(),
  }
}

export function automationDraftFromRecord(
  automation: AutomationRecord
): AutomationDraft {
  return {
    autoEnvironment: automation.autoEnvironment ?? true,
    baseBranch: automation.baseBranch ?? "",
    branchMode: automation.branchMode ?? "auto",
    branchName: automation.branchName ?? "",
    model: automation.model,
    name: automation.name,
    prompt: automation.prompt,
    reasoningEffort: automation.reasoningEffort,
    repoUrl: automation.repoUrl,
    sandboxPresetId: automation.sandboxPresetId ?? "",
    sandboxRetention:
      automation.sandboxRetention ?? AUTOMATION_SANDBOX_RETENTION_DEFAULT,
    // Crons the structured kinds cannot express reopen losslessly as "Custom".
    schedule: automation.cron
      ? scheduleDraftFromCron(automation.cron)
      : { kind: "daily", time: "09:00" },
    speed: automation.speed,
    threadMode: automation.threadMode ?? AUTOMATION_THREAD_MODE_DEFAULT,
    timezone: automation.timezone,
  }
}

// Derives a presentable automation name from free text when the AI parse is
// unavailable: first clause, clipped at a word boundary.
export function deriveAutomationName(text: string) {
  const firstLine = text
    .trim()
    .split(/\n/)[0]
    .replace(/[.!?].*$/, "")
  const clipped =
    firstLine.length <= 48
      ? firstLine
      : `${firstLine.slice(0, 48).replace(/\s+\S*$/, "")}…`
  const name = clipped.trim() || "Automation"

  return name[0].toUpperCase() + name.slice(1)
}

/** Throws with a user-facing message when the draft is not submittable. */
export function automationRequestBody(draft: AutomationDraft) {
  return {
    autoEnvironment: draft.autoEnvironment,
    baseBranch: draft.baseBranch.trim() || undefined,
    branchMode: draft.branchMode,
    branchName: draft.branchName.trim() || undefined,
    cron: cronFromScheduleDraft(draft.schedule),
    model: draft.model,
    name: draft.name,
    prompt: draft.prompt,
    reasoningEffort: draft.reasoningEffort,
    repoUrl: draft.repoUrl,
    sandboxPresetId: draft.sandboxPresetId || undefined,
    sandboxRetention: draft.sandboxRetention,
    speed: draft.speed,
    threadMode: draft.threadMode,
    timezone: draft.timezone,
  }
}

export function formatInstantInZone(ms: number, timezone: string) {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    weekday: "short",
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...options,
      timeZone: timezone,
    }).format(ms)
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(ms)
  }
}

/** Compact "Thu 09:00" form for the inline next-run preview. */
export function formatInstantShort(ms: number, timezone: string) {
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    weekday: "short",
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...options,
      timeZone: timezone,
    }).format(ms)
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(ms)
  }
}

const RUN_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
})

/** "Jul 3, 14:32" style local timestamp for run history rows. */
export function formatRunTime(ms: number) {
  return RUN_TIME_FORMAT.format(ms)
}

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat(undefined, {
  numeric: "always",
  style: "narrow",
})

/** "in 3 hr" / "5 min ago" style compact relative time. */
export function formatRelative(ms: number, nowMs: number) {
  const deltaSeconds = Math.round((ms - nowMs) / 1000)
  const abs = Math.abs(deltaSeconds)
  if (abs < 60) return RELATIVE_FORMAT.format(deltaSeconds, "second")
  if (abs < 3600) {
    return RELATIVE_FORMAT.format(Math.round(deltaSeconds / 60), "minute")
  }
  if (abs < 86_400) {
    return RELATIVE_FORMAT.format(Math.round(deltaSeconds / 3600), "hour")
  }
  return RELATIVE_FORMAT.format(Math.round(deltaSeconds / 86_400), "day")
}
