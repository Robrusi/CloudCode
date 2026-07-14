import { v, type Infer } from "convex/values"

import type { Doc } from "../_generated/dataModel"
import { canonicalGitHubRepoUrl } from "@/lib/github/repo"

export const integrationProvider = v.union(
  v.literal("slack"),
  v.literal("linear")
)

export type IntegrationProvider = Infer<typeof integrationProvider>

/** Automation trigger config. Cron stays the default; GitHub, Slack, and Linear
 * kinds fire from webhook events instead of the scheduler. Legacy rows predate
 * this field: they carry cron/timezone columns only and read as the cron kind
 * through automationTriggerOf. */
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
    // Comment author filters are only meaningful for commentCreated. "any"
    // leaves the arrays empty; include/exclude compare stable Linear user IDs.
    commentAuthorIds: v.optional(v.array(v.string())),
    commentAuthorMode: v.optional(
      v.union(v.literal("any"), v.literal("include"), v.literal("exclude"))
    ),
    commentAuthorNames: v.optional(v.array(v.string())),
    event: v.union(
      v.literal("issueCreated"),
      v.literal("issueAssigned"),
      v.literal("labelAdded"),
      v.literal("statusChanged"),
      v.literal("commentCreated")
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
  }),
  v.object({
    // Optional actor filter is case-insensitive and applies to the sender of
    // the GitHub event. An unset value means any user (including other bots).
    actorLogin: v.optional(v.string()),
    // Optional branch filter applies only to push events. It is stored without
    // refs/heads/ so webhook refs and composer values compare consistently.
    branch: v.optional(v.string()),
    event: v.union(
      v.literal("issueOpened"),
      v.literal("issueClosed"),
      v.literal("issueCommented"),
      v.literal("pullRequestOpened"),
      v.literal("pullRequestMerged"),
      v.literal("pullRequestReviewSubmitted"),
      v.literal("push")
    ),
    // Persisted after the API verifies that this repository belongs to one of
    // the user's GitHub App installations. It lets disconnect/sync disable
    // only the triggers whose delivery source disappeared.
    installationId: v.optional(v.string()),
    kind: v.literal("github"),
  })
)

export type AutomationTrigger = Infer<typeof automationTrigger>

export const automationTriggerKind = v.union(
  v.literal("cron"),
  v.literal("slack"),
  v.literal("linear"),
  v.literal("github")
)

export function githubAutomationTriggerSourceKey(
  repoUrl: string,
  event: Extract<AutomationTrigger, { kind: "github" }>["event"]
) {
  const canonicalRepoUrl = canonicalGitHubRepoUrl(repoUrl) ?? repoUrl.trim()
  return `github:${canonicalRepoUrl.toLowerCase()}:${event}`
}

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
 * predicates (channel, keyword, emoji, team, label, state, actor, branch) are
 * applied in code on the handful of matches. Cron automations have no source
 * key — the scheduler finds them through nextRunAt instead. */
export function automationTriggerSourceKey(
  trigger: AutomationTrigger,
  repoUrl?: string
): string | undefined {
  if (trigger.kind === "cron") return undefined
  if (trigger.kind === "github") {
    return repoUrl
      ? githubAutomationTriggerSourceKey(repoUrl, trigger.event)
      : undefined
  }
  return `${trigger.kind}:${trigger.installationId}:${trigger.event}`
}
