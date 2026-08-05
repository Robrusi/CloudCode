import { v, type Infer } from "convex/values"

import { canonicalGitHubRepoUrl } from "@/lib/github/repo"

/**
 * Shared vocabulary for factory waits: the providers and event names an agent
 * may wait on, and the source-key builders that both wait creation and the
 * provider webhooks compute. Keeping the builders in one module means the
 * matching key can never drift between the Convex mutations that arm waits
 * and the Next.js routes that look them up.
 */

export const factoryWaitProvider = v.union(
  v.literal("slack"),
  v.literal("github"),
  v.literal("linear"),
  v.literal("external")
)

export type FactoryWaitProvider = Infer<typeof factoryWaitProvider>

export const factoryWaitStatus = v.union(
  // Persisted rollout compatibility only. These values belonged to the
  // retired message-posting flow and are never created or treated as active;
  // the minute sweep converts any remaining rows to canceled. Removing them
  // from validation before that cleanup would make Convex reject deployment.
  v.literal("arming"),
  v.literal("failed"),
  v.literal("armed"),
  // Consumed by a wake run (or superseded by the integration follow-up path).
  v.literal("fired"),
  v.literal("expired"),
  v.literal("canceled")
)

export type FactoryWaitStatus = Infer<typeof factoryWaitStatus>

export const SLACK_WAIT_EVENTS = ["reply", "reaction"] as const
export const GITHUB_WAIT_EVENTS = [
  "comment",
  "review",
  "merged",
  "closed",
  "reopened",
  "checks",
] as const
export const LINEAR_WAIT_EVENTS = ["comment"] as const

export type SlackWaitEvent = (typeof SLACK_WAIT_EVENTS)[number]
export type GitHubWaitEvent = (typeof GITHUB_WAIT_EVENTS)[number]
export type LinearWaitEvent = (typeof LINEAR_WAIT_EVENTS)[number]
export type FactoryWaitEventName =
  | SlackWaitEvent
  | GitHubWaitEvent
  | LinearWaitEvent

export function factoryWaitEventsForProvider(
  provider: FactoryWaitProvider
): readonly string[] {
  if (provider === "slack") return SLACK_WAIT_EVENTS
  if (provider === "github") return GITHUB_WAIT_EVENTS
  if (provider === "linear") return LINEAR_WAIT_EVENTS
  return []
}

/** Match keys for a Slack wait: the thread root catches replies, the watched
 * message ts catches reactions. When the watched message is itself the thread
 * root the two collapse into one key. */
export function slackWaitSourceKeys(target: {
  channelId: string
  installationId: string
  messageTs: string
  threadTs?: string
}): string[] {
  const prefix = `slack:${target.installationId}:${target.channelId}`
  const keys = new Set([
    `${prefix}:${target.threadTs ?? target.messageTs}`,
    `${prefix}:${target.messageTs}`,
  ])
  return [...keys]
}

/** The key a Slack webhook event matches against: replies key on their
 * thread root, reactions on the reacted message's ts. */
export function slackWaitEventSourceKey(event: {
  channelId: string
  installationId: string
  ts: string
}) {
  return `slack:${event.installationId}:${event.channelId}:${event.ts}`
}

export function githubWaitSourceKey(repoUrl: string, prNumber: number) {
  const canonicalRepoUrl = canonicalGitHubRepoUrl(repoUrl) ?? repoUrl.trim()
  return `github:${canonicalRepoUrl.toLowerCase()}:pr:${prNumber}`
}

export function githubInstallationWaitSourceKey(
  installationId: string,
  repoUrl: string,
  prNumber: number
) {
  const canonicalRepoUrl = canonicalGitHubRepoUrl(repoUrl) ?? repoUrl.trim()
  return `github:${installationId}:${canonicalRepoUrl.toLowerCase()}:pr:${prNumber}`
}

export function linearWaitSourceKey(installationId: string, issueId: string) {
  return `linear:${installationId}:${issueId}`
}

/** Maps GitHub webhook events onto the compact vocabulary used by waits on
 * one specific PR. Repository-wide event waits retain the provider event
 * name and use the trigger helpers in integrationTriggers.ts. */
const GITHUB_EVENT_TO_WAIT_EVENT: Record<string, GitHubWaitEvent> = {
  checkSuiteCompleted: "checks",
  issueCommented: "comment",
  pullRequestClosed: "closed",
  pullRequestMerged: "merged",
  pullRequestReopened: "reopened",
  pullRequestReviewCommented: "comment",
  pullRequestReviewSubmitted: "review",
}

export function githubWaitEventName(event: string): GitHubWaitEvent | null {
  return GITHUB_EVENT_TO_WAIT_EVENT[event] ?? null
}
