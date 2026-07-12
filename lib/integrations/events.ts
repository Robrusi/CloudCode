import type { Id } from "@/convex/_generated/dataModel"
import type { AutomationTrigger } from "@/convex/lib/integrationTriggers"
import type { SlackThreadContextMessage } from "@/lib/integrations/slack-threads"

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
  externalId?: string
  externalThreadId: string
  kind: "mention" | "follow_up"
  linearAgentSessionId?: string
  linearIssueId?: string
  messageId: string
  presetOverride?: string
  provider: "slack" | "linear"
  repoOverride?: string
  slackThreadContext?: SlackThreadContextMessage[]
  subject?: IntegrationEventSubject
  text: string
}

/** A Slack channel event (keyword match or reaction) that pre-matched at
 * least one enabled event automation in the webhook handler. */
export type SlackAutomationEventPayload = {
  authorName?: string
  automationIds: Id<"automations">[]
  channelId: string
  emoji?: string
  event: "keyword" | "reaction"
  externalId: string
  externalThreadId: string
  kind: "slack_automation"
  messageId: string
  messageText?: string
  provider: "slack"
}

export type LinearIssueAutomationEvent = {
  addedLabels?: Array<{ id: string; name?: string }>
  event: "issueCreated" | "issueAssigned" | "labelAdded" | "statusChanged"
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

/** Linear Issue data-change events (creation, assignment, labels, workflow
 * state) parsed from the raw webhook before the Chat SDK adapter sees the
 * request. */
export type LinearAutomationEventPayload = {
  deliveryId?: string
  events: LinearIssueAutomationEvent[]
  externalId: string
  kind: "linear_automation"
  provider: "linear"
}

export type IntegrationEventPayload =
  | IntegrationChatEventPayload
  | SlackAutomationEventPayload
  | LinearAutomationEventPayload

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
    if (payload.slackThreadContext?.length) {
      context.push(
        "",
        "Slack thread before this request:",
        ...payload.slackThreadContext.map(
          (message) =>
            `[${message.authorName}] ${message.text.replace(/\n/g, "\n  ")}`
        )
      )
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
  event: LinearIssueAutomationEvent
): EventContextVars {
  return {
    addedLabels: (event.addedLabels ?? [])
      .map((label) => label.name ?? label.id)
      .join(", "),
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

/** Fine-grained predicate applied after the source-key lookup. IDs are used
 * for matching so renamed labels, statuses, teams, or people stay stable. */
export function linearAutomationEventMatches(
  trigger: Extract<AutomationTrigger, { kind: "linear" }>,
  event: LinearIssueAutomationEvent
) {
  if (trigger.event !== event.event) return false
  if (trigger.teamId && trigger.teamId !== event.issue.teamId) return false
  if (
    trigger.event === "issueAssigned" &&
    trigger.assigneeId !== event.issue.assigneeId
  ) {
    return false
  }
  if (
    trigger.event === "labelAdded" &&
    !event.addedLabels?.some((label) => label.id === trigger.labelId)
  ) {
    return false
  }
  if (
    trigger.event === "statusChanged" &&
    trigger.stateId &&
    trigger.stateId !== event.issue.stateId
  ) {
    return false
  }
  return true
}
