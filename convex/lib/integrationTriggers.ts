import { v, type Infer } from "convex/values"

import type { Doc } from "../_generated/dataModel"
import { canonicalGitHubRepoUrl } from "@/lib/github/repo"
import type { GitHubAutomationEventName } from "@/lib/github/automation-events"

export const integrationProvider = v.union(
  v.literal("slack"),
  v.literal("linear")
)

export type IntegrationProvider = Infer<typeof integrationProvider>

export const LINEAR_INTEGRATION_EVENTS = [
  "issueCreated",
  "issueAssigned",
  "labelAdded",
  "statusChanged",
  "commentCreated",
] as const

const linearIntegrationEvent = v.union(
  v.literal("issueCreated"),
  v.literal("issueAssigned"),
  v.literal("labelAdded"),
  v.literal("statusChanged"),
  v.literal("commentCreated")
)

/** Shared Linear event filter used by both automations and durable Factory
 * waits. IDs are authoritative; names are denormalized display labels. */
export const linearIntegrationTrigger = v.object({
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
  event: linearIntegrationEvent,
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

export type LinearIntegrationTrigger = Infer<typeof linearIntegrationTrigger>

export const EXTERNAL_FACTORY_WAIT_PROVIDERS = [
  "sentry",
  "datadog",
  "pagerduty",
  "webhook",
] as const

export type SupportedExternalFactoryWaitProvider =
  (typeof EXTERNAL_FACTORY_WAIT_PROVIDERS)[number]

// Deliberately open so adding a provider parser does not require rewriting
// persisted endpoint or wait documents. Tool-facing code still checks the
// currently supported provider catalog above.
export const externalFactoryWaitProvider = v.string()

export type ExternalFactoryWaitProvider = Infer<
  typeof externalFactoryWaitProvider
>

/** Provider-neutral envelope for authenticated webhook sources. Event names
 * and normalized string filters are intentionally open: adding a provider
 * event does not require a database schema migration. */
export const externalFactoryWaitTrigger = v.object({
  endpointId: v.id("factoryWebhookEndpoints"),
  event: v.string(),
  filters: v.optional(v.record(v.string(), v.string())),
  kind: v.literal("external"),
  provider: externalFactoryWaitProvider,
})

export type ExternalFactoryWaitTrigger = Infer<
  typeof externalFactoryWaitTrigger
>

const githubAutomationEvent = v.union(
  v.literal("issueOpened"),
  v.literal("issueClosed"),
  v.literal("issueCommented"),
  v.literal("pullRequestOpened"),
  v.literal("pullRequestMerged"),
  v.literal("pullRequestReviewSubmitted"),
  v.literal("push")
)

export const GITHUB_FACTORY_WAIT_EVENTS = [
  "issueOpened",
  "issueClosed",
  "issueCommented",
  "pullRequestOpened",
  "pullRequestMerged",
  "pullRequestClosed",
  "pullRequestReopened",
  "pullRequestReviewSubmitted",
  "pullRequestReviewCommented",
  "checkSuiteCompleted",
  "push",
] as const satisfies readonly GitHubAutomationEventName[]

const githubFactoryWaitEvent = v.union(
  v.literal("issueOpened"),
  v.literal("issueClosed"),
  v.literal("issueCommented"),
  v.literal("pullRequestOpened"),
  v.literal("pullRequestMerged"),
  v.literal("pullRequestClosed"),
  v.literal("pullRequestReopened"),
  v.literal("pullRequestReviewSubmitted"),
  v.literal("pullRequestReviewCommented"),
  v.literal("checkSuiteCompleted"),
  v.literal("push")
)

const githubTriggerCommonFields = {
  // Optional actor filter is case-insensitive and applies to the sender of
  // the GitHub event. An unset value means any user (including other bots).
  actorLogin: v.optional(v.string()),
  // Optional branch filter applies only to push events. It is stored without
  // refs/heads/ so webhook refs and composer values compare consistently.
  branch: v.optional(v.string()),
  // Persisted after the API verifies that this repository belongs to one of
  // the user's GitHub App installations. Factory waits omit it and are
  // restricted to installation owners when matching the webhook.
  installationId: v.optional(v.string()),
  kind: v.literal("github"),
}

export const githubAutomationTrigger = v.object({
  ...githubTriggerCommonFields,
  event: githubAutomationEvent,
})

export const githubFactoryWaitTrigger = v.object({
  ...githubTriggerCommonFields,
  event: githubFactoryWaitEvent,
})

export type GitHubFactoryWaitTrigger = Infer<typeof githubFactoryWaitTrigger>

export const factoryEventWaitTrigger = v.union(
  githubFactoryWaitTrigger,
  linearIntegrationTrigger,
  externalFactoryWaitTrigger
)

export type FactoryEventWaitTrigger = Infer<typeof factoryEventWaitTrigger>

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
  linearIntegrationTrigger,
  githubAutomationTrigger
)

export type AutomationTrigger = Infer<typeof automationTrigger>

export const automationTriggerKind = v.union(
  v.literal("cron"),
  v.literal("slack"),
  v.literal("linear"),
  v.literal("github")
)

export function githubEventTriggerSourceKey(
  repoUrl: string,
  event: GitHubAutomationEventName
) {
  const canonicalRepoUrl = canonicalGitHubRepoUrl(repoUrl) ?? repoUrl.trim()
  return `github:${canonicalRepoUrl.toLowerCase()}:${event}`
}

export function githubInstallationEventTriggerSourceKey(
  installationId: string,
  repoUrl: string,
  event: GitHubAutomationEventName
) {
  const canonicalRepoUrl = canonicalGitHubRepoUrl(repoUrl) ?? repoUrl.trim()
  return `github:${installationId}:${canonicalRepoUrl.toLowerCase()}:${event}`
}

export const githubAutomationTriggerSourceKey = githubEventTriggerSourceKey

export function linearEventTriggerSourceKey(
  installationId: string,
  event: LinearIntegrationTrigger["event"]
) {
  return `linear:${installationId}:${event}`
}

export function externalEventTriggerSourceKey(
  endpointId: string,
  event: string
) {
  return `external:${endpointId}:${event.trim().toLowerCase()}`
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
      ? githubEventTriggerSourceKey(repoUrl, trigger.event)
      : undefined
  }
  if (trigger.kind === "linear") {
    return linearEventTriggerSourceKey(trigger.installationId, trigger.event)
  }
  return `${trigger.kind}:${trigger.installationId}:${trigger.event}`
}
