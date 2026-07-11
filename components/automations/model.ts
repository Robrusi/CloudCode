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
  shortScheduleLabel,
  type ScheduleDraft,
} from "@/lib/automations/schedule-draft"

export type AutomationRecord = Doc<"automations">

/** Composer-side trigger config. Cron keeps its schedule in the draft's
 * schedule/timezone fields; the event kinds carry their own selection. */
export type TriggerDraft =
  | { kind: "cron" }
  | {
      channelId: string
      channelName: string
      emoji: string
      event: "keyword" | "reaction"
      installationId: string
      keyword: string
      kind: "slack"
    }
  | {
      event: "issueCreated" | "labelAdded" | "statusChanged"
      installationId: string
      kind: "linear"
      labelId: string
      labelName: string
      stateId: string
      stateName: string
      teamId: string
      teamName: string
    }

export function emptySlackTrigger(installationId: string): TriggerDraft {
  return {
    channelId: "",
    channelName: "",
    emoji: "",
    event: "keyword",
    installationId,
    keyword: "",
    kind: "slack",
  }
}

export function emptyLinearTrigger(installationId: string): TriggerDraft {
  return {
    event: "labelAdded",
    installationId,
    kind: "linear",
    labelId: "",
    labelName: "",
    stateId: "",
    stateName: "",
    teamId: "",
    teamName: "",
  }
}

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
  trigger: TriggerDraft
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
    trigger: { kind: "cron" },
  }
}

function triggerDraftFromRecord(automation: AutomationRecord): TriggerDraft {
  const trigger = automation.trigger
  if (!trigger || trigger.kind === "cron") return { kind: "cron" }
  if (trigger.kind === "slack") {
    return {
      channelId: trigger.channelId ?? "",
      channelName: trigger.channelName ?? "",
      emoji: trigger.emoji ?? "",
      event: trigger.event,
      installationId: trigger.installationId,
      keyword: trigger.keyword ?? "",
      kind: "slack",
    }
  }
  return {
    event: trigger.event,
    installationId: trigger.installationId,
    kind: "linear",
    labelId: trigger.labelId ?? "",
    labelName: trigger.labelName ?? "",
    stateId: trigger.stateId ?? "",
    stateName: trigger.stateName ?? "",
    teamId: trigger.teamId ?? "",
    teamName: trigger.teamName ?? "",
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
    timezone: automation.timezone ?? browserTimezone(),
    trigger: triggerDraftFromRecord(automation),
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

function triggerRequestBody(draft: AutomationDraft) {
  const trigger = draft.trigger
  if (trigger.kind === "cron") {
    return {
      cron: cronFromScheduleDraft(draft.schedule),
      kind: "cron" as const,
      timezone: draft.timezone,
    }
  }
  if (trigger.kind === "slack") {
    return {
      channelId: trigger.channelId || undefined,
      channelName: trigger.channelName || undefined,
      emoji: trigger.emoji || undefined,
      event: trigger.event,
      installationId: trigger.installationId,
      keyword: trigger.keyword || undefined,
      kind: "slack" as const,
    }
  }
  return {
    event: trigger.event,
    installationId: trigger.installationId,
    kind: "linear" as const,
    labelId: trigger.labelId || undefined,
    labelName: trigger.labelName || undefined,
    stateId: trigger.stateId || undefined,
    stateName: trigger.stateName || undefined,
    teamId: trigger.teamId || undefined,
    teamName: trigger.teamName || undefined,
  }
}

/** Throws with a user-facing message when the draft is not submittable. */
export function automationRequestBody(draft: AutomationDraft) {
  return {
    autoEnvironment: draft.autoEnvironment,
    baseBranch: draft.baseBranch.trim() || undefined,
    branchMode: draft.branchMode,
    branchName: draft.branchName.trim() || undefined,
    model: draft.model,
    name: draft.name,
    prompt: draft.prompt,
    reasoningEffort: draft.reasoningEffort,
    repoUrl: draft.repoUrl,
    sandboxPresetId: draft.sandboxPresetId || undefined,
    sandboxRetention: draft.sandboxRetention,
    speed: draft.speed,
    threadMode: draft.threadMode,
    trigger: triggerRequestBody(draft),
  }
}

/** One-line row label: the schedule for cron automations, the watched event
 * for Slack/Linear ones. */
export function automationTriggerLabel(automation: AutomationRecord) {
  const trigger = automation.trigger
  if (!trigger || trigger.kind === "cron") {
    const cron = trigger?.kind === "cron" ? trigger.cron : automation.cron
    return cron ? shortScheduleLabel(scheduleDraftFromCron(cron)) : "Schedule"
  }
  if (trigger.kind === "slack") {
    const where = trigger.channelName ? ` in #${trigger.channelName}` : ""
    return trigger.event === "reaction"
      ? `On :${trigger.emoji}: reaction${where}`
      : `On “${trigger.keyword}”${where}`
  }
  const scope = trigger.teamName ? ` in ${trigger.teamName}` : ""
  if (trigger.event === "issueCreated") {
    return `On new issue${scope}`
  }
  if (trigger.event === "labelAdded") {
    return `On label “${trigger.labelName || trigger.labelId}”${scope}`
  }
  return trigger.stateName
    ? `On status → ${trigger.stateName}${scope}`
    : `On status change${scope}`
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
