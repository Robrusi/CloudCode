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
  v.literal("linear")
)

export type FactoryWaitProvider = Infer<typeof factoryWaitProvider>

export const factoryWaitStatus = v.union(
  // ask_human: the Slack post has been handed to the arm task but its
  // message ts is not yet confirmed, so no match keys exist yet.
  v.literal("arming"),
  v.literal("armed"),
  // Consumed by a wake run (or superseded by the integration follow-up path).
  v.literal("fired"),
  v.literal("expired"),
  v.literal("canceled"),
  // The arm task exhausted its retries; the agent is woken about it.
  v.literal("failed")
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
  return LINEAR_WAIT_EVENTS
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

export function linearWaitSourceKey(installationId: string, issueId: string) {
  return `linear:${installationId}:${issueId}`
}

/** Maps the GitHub webhook automation event names onto the coarser wait
 * event vocabulary an agent filters on. Events without a mapping (issues,
 * pushes, PR opens) can never wake a wait. */
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
