import { v, type Infer } from "convex/values"

import type { Doc } from "../_generated/dataModel"

export const integrationProvider = v.union(
  v.literal("slack"),
  v.literal("linear")
)

export type IntegrationProvider = Infer<typeof integrationProvider>

/** Automation trigger config. Cron stays the default; the Slack and Linear
 * kinds fire from integration webhook events instead of the scheduler. Legacy
 * rows predate this field: they carry cron/timezone columns only and read as
 * the cron kind through automationTriggerOf. */
export const automationTrigger = v.union(
  v.object({
    cron: v.string(),
    kind: v.literal("cron"),
    timezone: v.string(),
  }),
  v.object({
    // Unset channel means any channel the Slack bot is a member of.
    channelId: v.optional(v.string()),
    channelName: v.optional(v.string()),
    emoji: v.optional(v.string()),
    event: v.union(v.literal("keyword"), v.literal("reaction")),
    installationId: v.id("integrationInstallations"),
    keyword: v.optional(v.string()),
    kind: v.literal("slack"),
  }),
  v.object({
    // Required for issueAssigned; stored with the name for readable labels.
    assigneeId: v.optional(v.string()),
    assigneeName: v.optional(v.string()),
    event: v.union(
      v.literal("issueCreated"),
      v.literal("issueAssigned"),
      v.literal("labelAdded"),
      v.literal("statusChanged")
    ),
    installationId: v.id("integrationInstallations"),
    kind: v.literal("linear"),
    labelId: v.optional(v.string()),
    labelName: v.optional(v.string()),
    // Unset state means any status change on the team's issues.
    stateId: v.optional(v.string()),
    stateName: v.optional(v.string()),
    // Unset team means issues from every team in the workspace.
    teamId: v.optional(v.string()),
    teamName: v.optional(v.string()),
  })
)

export type AutomationTrigger = Infer<typeof automationTrigger>

export const automationTriggerKind = v.union(
  v.literal("cron"),
  v.literal("slack"),
  v.literal("linear")
)

/** Canonical trigger for an automation row, deriving the cron kind for legacy
 * rows that predate the trigger column. */
export function automationTriggerOf(
  automation: Pick<Doc<"automations">, "cron" | "timezone" | "trigger">
): AutomationTrigger {
  if (automation.trigger) return automation.trigger
  return {
    cron: automation.cron ?? "",
    kind: "cron",
    timezone: automation.timezone ?? "UTC",
  }
}

/** Coarse index key for event-triggered automations. Webhook events compute
 * the same key and look automations up through by_trigger_source; the finer
 * predicates (channel, keyword, emoji, team, label, state) are applied in
 * code on the handful of matches. Cron automations have no source key — the
 * scheduler finds them through nextRunAt instead. */
export function automationTriggerSourceKey(
  trigger: AutomationTrigger
): string | undefined {
  if (trigger.kind === "cron") return undefined
  return `${trigger.kind}:${trigger.installationId}:${trigger.event}`
}
