import type { Id } from "@/convex/_generated/dataModel"
import type { GitHubWaitEvent } from "@/convex/lib/factoryWaitTriggers"
import type {
  ExternalFactoryWaitProvider,
  GitHubFactoryWaitTrigger,
  LinearIntegrationTrigger,
} from "@/convex/lib/integrationTriggers"
import type { GitHubAutomationEvent } from "@/lib/github/automation-events"

/** Subject context captured with a chat event: the Linear issue behind an
 * agent session, normalized from the Chat SDK's MessageSubject. */
export type IntegrationEventSubject = {
  description?: string
  labels?: string[]
  status?: string
  title?: string
  url?: string
}

/** A mention or follow-up message from Slack or Linear, forwarded by the
 * webhook handler to the integration-event Trigger task. */
export type IntegrationChatEventPayload = {
  authorEmail?: string
  authorName: string
  effortOverride?: string
  externalId?: string
  externalThreadId: string
  kind: "mention" | "follow_up"
  linearAgentSessionId?: string
  linearIssueId?: string
  messageId: string
  modelOverride?: string
  presetOverride?: string
  provider: "slack" | "linear"
  repoOverride?: string
  slackChannelName?: string
  slackThreadTs?: string
  subject?: IntegrationEventSubject
  text: string
}

/** A Slack channel event (keyword match or reaction) that pre-matched at
 * least one enabled event automation in the webhook handler. */
export type SlackAutomationEventPayload = {
  actorUserId?: string
  authorName?: string
  automationIds: Id<"automations">[]
  channelId: string
  emoji?: string
  event: "keyword" | "reaction"
  eventId?: string
  externalId: string
  externalThreadId: string
  kind: "slack_automation"
  messageId: string
  messageText?: string
  provider: "slack"
}

export type LinearAutomationEvent = {
  actorId?: string
  actorName?: string
  actorType?: string
  addedLabels?: Array<{ id: string; name?: string }>
  comment?: {
    authorId?: string
    authorName?: string
    body?: string
    id: string
    url?: string
  }
  event:
    | "issueCreated"
    | "issueAssigned"
    | "labelAdded"
    | "statusChanged"
    | "commentCreated"
  issue: {
    assigneeId?: string
    assigneeName?: string
    description?: string
    id: string
    identifier?: string
    labels?: Array<{ id: string; name?: string }>
    stateId?: string
    stateName?: string
    teamId?: string
    title?: string
    url?: string
  }
}

/** Linear issue changes and comment creations parsed from the raw webhook
 * before the Chat SDK adapter sees the request. */
export type LinearAutomationEventPayload = {
  deliveryId?: string
  events: LinearAutomationEvent[]
  externalId: string
  kind: "linear_automation"
  provider: "linear"
}

export type GitHubAutomationEventPayload = {
  deliveryId?: string
  event: GitHubAutomationEvent
  kind: "github_automation"
  provider: "github"
}

/** Durable ingress candidate. Matching happens in the retrying worker so a
 * transient Convex outage cannot silently turn a received GitHub event into
 * a Factory wait timeout. */
export type GitHubWaitCandidatePayload = {
  deliveryId?: string
  event: GitHubAutomationEvent
  kind: "github_wait_candidate"
  provider: "github"
  receivedAt: number
}

export type ExternalWaitCandidatePayload = {
  endpointId: Id<"factoryWebhookEndpoints">
  eventKey: string
  eventName: string
  eventVars: EventContextVars
  kind: "external_wait_candidate"
  provider: ExternalFactoryWaitProvider
  receivedAt: number
}

export type FactoryWaitIngressCandidatePayload =
  | GitHubWaitCandidatePayload
  | ExternalWaitCandidatePayload

export type FactoryWaitIngressPayload = {
  ingressId: Id<"factoryWaitIngressEvents">
  kind: "wait_ingress"
}

/** A provider event that pre-matched at least one armed factory wait in the
 * webhook handler. The eventVars carry the human-readable pieces the wake
 * prompt renders: summary (one line), text (quoted body), and url. */
export type FactoryWaitEventPayload = {
  eventKey: string
  eventName: string
  eventVars: EventContextVars
  // Slack replies carry the event's external thread id so the recorder can
  // detect threads whose replies the follow-up pipeline already delivers.
  externalThreadId?: string
  kind: "wait_event"
  provider: "slack" | "github" | "linear" | "external"
  // When the verified webhook was received; wait expiry is judged against
  // this so task-queue delay cannot turn an in-time answer into a timeout.
  receivedAt?: number
  // Inputs for the Slack author-name enrichment done in the worker.
  slack?: {
    actorUserId?: string
    externalId: string
  }
  waits: Array<{
    // Structured event waits store provider event names while legacy
    // target-specific waits retain their compact event vocabulary.
    eventName?: string
    threadId: Id<"threads">
    waitId: Id<"factoryWaits">
  }>
}

export type IntegrationEventPayload =
  | IntegrationChatEventPayload
  | SlackAutomationEventPayload
  | LinearAutomationEventPayload
  | GitHubAutomationEventPayload
  | GitHubWaitCandidatePayload
  | ExternalWaitCandidatePayload
  | FactoryWaitIngressPayload
  | FactoryWaitEventPayload

/** Template variables an event exposes to automation prompts as
 * {{event.name}} placeholders. */
export type EventContextVars = Record<string, string>

const EVENT_VAR_RE = /\{\{\s*event\.([a-zA-Z0-9_]+)\s*\}\}/g

/** Interpolates {{event.*}} placeholders and appends a compact context block
 * so prompts without placeholders still see the triggering event. */
export function applyEventContext(prompt: string, vars: EventContextVars) {
  const interpolated = prompt.replace(
    EVENT_VAR_RE,
    (match, name: string) => vars[name] ?? match
  )

  const lines = Object.entries(vars)
    .filter(([, value]) => value)
    .map(([name, value]) => `- ${name}: ${value}`)
  if (lines.length === 0) return interpolated

  return `${interpolated}\n\n---\nTriggering event:\n${lines.join("\n")}`
}

/** The instruction prompt for a session started from a chat mention: the
 * user's text plus the external context the agent cannot otherwise see. */
export function chatEventPrompt(payload: IntegrationChatEventPayload) {
  const instruction =
    payload.text.trim() ||
    (payload.provider === "linear"
      ? "Work on this Linear issue."
      : "Take a look at this thread and help out.")

  const context: string[] = []
  if (payload.provider === "linear" && payload.subject?.title) {
    const subject = payload.subject
    context.push(
      `Linear issue: ${subject.title}${subject.url ? ` (${subject.url})` : ""}`
    )
    if (subject.status) context.push(`Status: ${subject.status}`)
    if (subject.labels?.length) {
      context.push(`Labels: ${subject.labels.join(", ")}`)
    }
    if (subject.description) {
      context.push("", subject.description)
    }
  } else if (payload.provider === "slack") {
    context.push(`Requested by ${payload.authorName} from Slack.`)
    if (payload.slackChannelName) {
      context.push(`Slack channel: ${payload.slackChannelName}`)
    }
    if (payload.slackThreadTs) {
      context.push(`Slack thread: ${payload.slackThreadTs}`)
    }
  }

  return context.length > 0
    ? `${instruction}\n\n---\n${context.join("\n")}`
    : instruction
}

export function slackAutomationEventVars(
  payload: SlackAutomationEventPayload
): EventContextVars {
  return {
    author: payload.authorName ?? "",
    channel: payload.channelId,
    emoji: payload.emoji ?? "",
    message: payload.messageText ?? "",
    source: "slack",
    workspace: payload.externalId,
  }
}

export function linearAutomationEventVars(
  event: LinearAutomationEvent
): EventContextVars {
  return {
    addedLabels: (event.addedLabels ?? [])
      .map((label) => label.name ?? label.id)
      .join(", "),
    commentAuthor: event.comment?.authorName ?? "",
    commentAuthorId: event.comment?.authorId ?? "",
    commentBody: event.comment?.body ?? "",
    commentId: event.comment?.id ?? "",
    commentUrl: event.comment?.url ?? "",
    event: event.event,
    issueAssignee: event.issue.assigneeName ?? event.issue.assigneeId ?? "",
    issueDescription: event.issue.description ?? "",
    issueId: event.issue.identifier ?? event.issue.id,
    issueStatus: event.issue.stateName ?? "",
    issueTitle: event.issue.title ?? "",
    issueUrl: event.issue.url ?? "",
    source: "linear",
  }
}

export function githubAutomationEventVars(
  event: GitHubAutomationEvent
): EventContextVars {
  const target = event.pullRequest ?? event.issue
  return {
    action: event.action,
    actor: event.actorLogin ?? "",
    branch: event.branch ?? "",
    comment: event.comment?.body ?? "",
    commentUrl: event.comment?.url ?? "",
    event: event.event,
    isPullRequest: event.issue?.isPullRequest ? "true" : "false",
    issueBody: event.issue?.body ?? "",
    number: target ? String(target.number) : "",
    pullRequestBaseBranch: event.pullRequest?.baseBranch ?? "",
    pullRequestBody: event.pullRequest?.body ?? "",
    pullRequestHeadBranch: event.pullRequest?.headBranch ?? "",
    repository: event.repoFullName,
    repositoryUrl: event.repoUrl,
    review: event.review?.body ?? "",
    reviewState: event.review?.state ?? "",
    reviewUrl: event.review?.url ?? "",
    source: "github",
    title: target?.title ?? "",
    url: target?.url ?? "",
    pushAfter: event.push?.after ?? "",
    pushBefore: event.push?.before ?? "",
    pushCompareUrl: event.push?.compareUrl ?? "",
    pushHeadCommitMessage: event.push?.headCommitMessage ?? "",
  }
}

/** Human-readable wake context for repository-scoped GitHub event waits.
 * Authored comment/review text is quoted by the wake prompt; PR and issue
 * bodies stay at the source URL because opening an item is only a signal. */
export function githubEventWaitVars(
  event: GitHubAutomationEvent
): EventContextVars {
  const vars = githubAutomationEventVars(event)
  const actor = event.actorLogin ?? "someone"
  const target = event.pullRequest ?? event.issue
  const number = target ? `#${target.number}` : ""
  const title = target?.title ? ` (${target.title})` : ""

  let summary: string
  switch (event.event) {
    case "issueOpened":
      summary = `GitHub issue ${number} opened by ${actor}${title}`
      break
    case "issueClosed":
      summary = `GitHub issue ${number} closed by ${actor}${title}`
      break
    case "issueCommented":
      summary = `GitHub ${event.issue?.isPullRequest ? "PR" : "issue"} ${number} comment from ${actor}${title}`
      break
    case "pullRequestOpened":
      summary = `GitHub PR ${number} opened by ${actor}${title}`
      break
    case "pullRequestMerged":
      summary = `GitHub PR ${number} merged by ${actor}${title}`
      break
    case "pullRequestClosed":
      summary = `GitHub PR ${number} closed without merging by ${actor}${title}`
      break
    case "pullRequestReopened":
      summary = `GitHub PR ${number} reopened by ${actor}${title}`
      break
    case "pullRequestReviewSubmitted":
      summary = `GitHub PR ${number} review ${event.review?.state ?? "submitted"} by ${actor}${title}`
      break
    case "pullRequestReviewCommented":
      summary = `GitHub PR ${number} review comment from ${actor}${title}`
      break
    case "checkSuiteCompleted":
      summary = `GitHub checks completed with ${event.checkSuite?.conclusion ?? "an unknown conclusion"} on ${event.checkSuite?.headBranch ?? "an unknown branch"}`
      break
    case "push":
      summary = `GitHub push to ${event.branch ?? "an unknown branch"} by ${actor}`
      break
  }

  return {
    ...vars,
    summary,
    text: event.comment?.body ?? event.review?.body ?? "",
    url:
      event.comment?.url ??
      event.review?.url ??
      target?.url ??
      event.push?.compareUrl ??
      "",
  }
}

/** Same-repo pull requests a GitHub event concerns, for wait matching. A
 * comment on a plain issue (or a fork's check suite) yields none and can
 * never wake a PR wait. */
export function githubWaitPullRequestNumbers(
  event: GitHubAutomationEvent
): number[] {
  if (event.pullRequest) return [event.pullRequest.number]
  if (event.issue?.isPullRequest) return [event.issue.number]
  if (event.checkSuite) return event.checkSuite.pullRequests
  return []
}

export function githubWaitEventVars(
  event: GitHubAutomationEvent,
  waitEventName: GitHubWaitEvent
): EventContextVars {
  const prLabel = githubWaitPullRequestNumbers(event)
    .map((number) => `#${number}`)
    .join(", ")
  const actor = event.actorLogin ?? "someone"
  const base: EventContextVars = {
    actor,
    event: waitEventName,
    prNumber: githubWaitPullRequestNumbers(event).join(","),
    repository: event.repoFullName,
    source: "github",
  }

  switch (waitEventName) {
    case "comment":
      return {
        ...base,
        summary: `GitHub PR ${prLabel} comment from ${actor}`,
        text: event.comment?.body ?? "",
        url: event.comment?.url ?? event.pullRequest?.url ?? "",
      }
    case "review":
      return {
        ...base,
        summary: `GitHub PR ${prLabel} review ${event.review?.state ?? "submitted"} by ${actor}`,
        text: event.review?.body ?? "",
        url: event.review?.url ?? event.pullRequest?.url ?? "",
      }
    case "merged":
      return {
        ...base,
        summary: `GitHub PR ${prLabel} was merged by ${actor}`,
        url: event.pullRequest?.url ?? "",
      }
    case "closed":
      return {
        ...base,
        summary: `GitHub PR ${prLabel} was closed without merging by ${actor}`,
        url: event.pullRequest?.url ?? "",
      }
    case "reopened":
      return {
        ...base,
        summary: `GitHub PR ${prLabel} was reopened by ${actor}`,
        url: event.pullRequest?.url ?? "",
      }
    case "checks":
      return {
        ...base,
        conclusion: event.checkSuite?.conclusion ?? "",
        summary: `GitHub checks completed with ${event.checkSuite?.conclusion ?? "an unknown conclusion"} on ${event.checkSuite?.headBranch ?? "?"} (PR ${prLabel})`,
      }
  }
}

export function linearWaitEventVars(
  event: LinearAutomationEvent
): EventContextVars {
  const author =
    event.comment?.authorName ?? event.comment?.authorId ?? "someone"
  const issueLabel = event.issue.identifier ?? event.issue.id
  return {
    author,
    event: "comment",
    issueId: event.issue.id,
    source: "linear",
    summary: `Linear comment from ${author} on ${issueLabel}${event.issue.title ? ` (${event.issue.title})` : ""}`,
    text: event.comment?.body ?? "",
    url: event.comment?.url ?? event.issue.url ?? "",
  }
}

export function linearEventWaitVars(
  event: LinearAutomationEvent
): EventContextVars {
  const vars = linearAutomationEventVars(event)
  const issueLabel = event.issue.identifier ?? event.issue.id
  const title = event.issue.title ? ` (${event.issue.title})` : ""
  let summary: string

  switch (event.event) {
    case "issueCreated":
      summary = `Linear issue ${issueLabel} created${title}`
      break
    case "issueAssigned":
      summary = `Linear issue ${issueLabel} assigned to ${event.issue.assigneeName ?? event.issue.assigneeId ?? "someone"}${title}`
      break
    case "labelAdded":
      summary = `Linear issue ${issueLabel} received label ${(event.addedLabels ?? []).map((label) => label.name ?? label.id).join(", ") || "unknown"}${title}`
      break
    case "statusChanged":
      summary = `Linear issue ${issueLabel} moved to ${event.issue.stateName ?? event.issue.stateId ?? "an unknown status"}${title}`
      break
    case "commentCreated":
      summary = `Linear comment from ${event.comment?.authorName ?? event.comment?.authorId ?? "someone"} on ${issueLabel}${title}`
      break
  }

  return {
    ...vars,
    summary,
    text: event.comment?.body ?? "",
    url: event.comment?.url ?? event.issue.url ?? "",
  }
}

export function githubIntegrationEventMatches(
  trigger: GitHubFactoryWaitTrigger,
  event: GitHubAutomationEvent
) {
  if (trigger.event !== event.event) return false
  if (
    trigger.actorLogin &&
    trigger.actorLogin.toLowerCase() !== event.actorLogin?.toLowerCase()
  ) {
    return false
  }
  if (
    trigger.event === "push" &&
    trigger.branch &&
    trigger.branch !== event.branch
  ) {
    return false
  }
  return true
}

/** Fine-grained predicate applied after the source-key lookup. IDs are used
 * for matching so renamed labels, statuses, teams, or people stay stable. */
export function linearIntegrationEventMatches(
  trigger: LinearIntegrationTrigger,
  event: LinearAutomationEvent
) {
  if (trigger.event !== event.event) return false
  if (trigger.event === "commentCreated") {
    const authorId = event.comment?.authorId
    const authorIds = trigger.commentAuthorIds ?? []
    const mode = trigger.commentAuthorMode ?? "any"
    if (mode === "include") {
      return Boolean(authorId && authorIds.includes(authorId))
    }
    if (mode === "exclude") {
      return !authorId || !authorIds.includes(authorId)
    }
    return true
  }
  if (trigger.teamId && trigger.teamId !== event.issue.teamId) return false
  if (trigger.assigneeId && trigger.assigneeId !== event.issue.assigneeId) {
    return false
  }
  if (trigger.labelId) {
    const labels =
      trigger.event === "labelAdded" ? event.addedLabels : event.issue.labels
    if (!labels?.some((label) => label.id === trigger.labelId)) return false
  }
  if (trigger.stateId && trigger.stateId !== event.issue.stateId) {
    return false
  }
  return true
}
