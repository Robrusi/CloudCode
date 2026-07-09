import type { Id } from "@/convex/_generated/dataModel"

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
  provider: "slack" | "linear"
  repoOverride?: string
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
  externalThreadId: string
  kind: "slack_automation"
  messageId: string
  messageText?: string
  provider: "slack"
}

export type LinearIssueAutomationEvent = {
  addedLabels?: Array<{ id: string; name?: string }>
  event: "labelAdded" | "statusChanged"
  issue: {
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

/** Linear Issue data-change events (labels, workflow state) parsed from the
 * raw webhook before the Chat SDK adapter sees the request. */
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
  }
}

export function linearAutomationEventVars(
  event: LinearIssueAutomationEvent
): EventContextVars {
  return {
    addedLabels: (event.addedLabels ?? [])
      .map((label) => label.name ?? label.id)
      .join(", "),
    issueDescription: event.issue.description ?? "",
    issueId: event.issue.identifier ?? event.issue.id,
    issueStatus: event.issue.stateName ?? "",
    issueTitle: event.issue.title ?? "",
    issueUrl: event.issue.url ?? "",
    source: "linear",
  }
}
