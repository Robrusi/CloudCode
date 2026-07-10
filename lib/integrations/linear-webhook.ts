import { createHmac, timingSafeEqual } from "node:crypto"

import type {
  IntegrationChatEventPayload,
  LinearIssueAutomationEvent,
} from "@/lib/integrations/events"
import { linearAgentSessionThreadId } from "@/lib/integrations/linear-threads"

const LINEAR_WEBHOOK_REPLAY_WINDOW_MS = 60 * 1000

/** HMAC-SHA256 verification of a raw Linear webhook body, mirroring
 * lib/github/webhook.ts. The Chat SDK adapter verifies again for the chat
 * flows; this guards the automation pre-processing path, which reads the
 * payload before the adapter does. */
export function verifyLinearWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
) {
  if (!signatureHeader) return false
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex")
  const provided = Buffer.from(signatureHeader)
  const computed = Buffer.from(expected)
  return (
    provided.length === computed.length && timingSafeEqual(provided, computed)
  )
}

export function verifyLinearWebhookTimestamp(
  timestampHeader: string | null,
  now = Date.now()
) {
  if (!timestampHeader) return false
  const sentAt = Number(timestampHeader)
  return (
    Number.isFinite(sentAt) &&
    Math.abs(now - sentAt) <= LINEAR_WEBHOOK_REPLAY_WINDOW_MS
  )
}

export function verifyLinearWebhookRequest(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  secret: string,
  now = Date.now()
) {
  return (
    verifyLinearWebhookSignature(rawBody, signatureHeader, secret) &&
    verifyLinearWebhookTimestamp(timestampHeader, now)
  )
}

type LinearIssuePayload = {
  action?: string
  data?: {
    description?: string
    id?: string
    identifier?: string
    labelIds?: string[]
    labels?: Array<{ id?: string; name?: string }>
    state?: { id?: string; name?: string }
    stateId?: string
    teamId?: string
    title?: string
    url?: string
  }
  organizationId?: string
  type?: string
  updatedFrom?: {
    labelIds?: string[]
    stateId?: string
  }
}

type LinearAgentSessionPayload = {
  action?: string
  agentSession?: {
    appUserId?: string
    comment?: unknown
    creator?: {
      email?: string
      name?: string
    }
    id?: string
    issue?: {
      description?: string
      id?: string
      identifier?: string
      title?: string
      url?: string
    }
    issueId?: string
  }
  appUserId?: string
  organizationId?: string
  promptContext?: string
  type?: string
  webhookId?: string
}

/** Builds the event the Linear adapter cannot currently build: a newly
 * delegated agent session with no root comment. Normal comment-backed
 * sessions stay exclusively on the adapter path to prevent duplicate runs. */
export function parseCommentlessLinearDelegation(
  payload: unknown
): { appUserId: string; event: IntegrationChatEventPayload } | null {
  const parsed = payload as LinearAgentSessionPayload
  const session = parsed?.agentSession
  if (
    parsed?.type !== "AgentSessionEvent" ||
    parsed.action !== "created" ||
    !session ||
    session.comment ||
    !session.id ||
    !parsed.organizationId
  ) {
    return null
  }

  const issueId = session.issueId ?? session.issue?.id
  const appUserId = session.appUserId ?? parsed.appUserId
  if (!issueId || !appUserId) return null

  const issue = session.issue
  const promptContext = parsed.promptContext?.trim()
  const issueLabel = issue?.identifier ?? issue?.title ?? "this Linear issue"
  return {
    appUserId,
    event: {
      authorEmail: session.creator?.email,
      authorName: session.creator?.name ?? "Linear",
      externalId: parsed.organizationId,
      externalThreadId: linearAgentSessionThreadId(issueId, session.id),
      kind: "mention",
      linearAgentSessionId: session.id,
      linearIssueId: issueId,
      messageId: parsed.webhookId ?? `agent-session:${session.id}:created`,
      provider: "linear",
      subject: issue
        ? {
            description: issue.description,
            title: issue.title ?? issue.identifier,
            url: issue.url,
          }
        : undefined,
      text: promptContext || `Work on ${issueLabel}.`,
    },
  }
}

/** Extracts automation-relevant Issue data changes (labels added, workflow
 * state changed) from a raw Linear webhook payload. Non-Issue events and
 * unrelated updates return an empty list. */
export function parseLinearIssueAutomationEvents(payload: unknown): {
  events: LinearIssueAutomationEvent[]
  organizationId?: string
} {
  const parsed = payload as LinearIssuePayload
  if (!parsed || parsed.type !== "Issue" || parsed.action !== "update") {
    return { events: [] }
  }
  const data = parsed.data
  const updatedFrom = parsed.updatedFrom
  if (!data?.id || !updatedFrom) return { events: [] }

  const labelNames = new Map(
    (data.labels ?? [])
      .filter((label): label is { id: string; name?: string } =>
        Boolean(label.id)
      )
      .map((label) => [label.id, label.name])
  )
  const issue = {
    description: data.description,
    id: data.id,
    identifier: data.identifier,
    labels: (data.labelIds ?? []).map((id) => ({
      id,
      name: labelNames.get(id),
    })),
    stateId: data.stateId ?? data.state?.id,
    stateName: data.state?.name,
    teamId: data.teamId,
    title: data.title,
    url: data.url,
  }

  const events: LinearIssueAutomationEvent[] = []

  if (updatedFrom.labelIds) {
    const previous = new Set(updatedFrom.labelIds)
    const added = (data.labelIds ?? []).filter((id) => !previous.has(id))
    if (added.length > 0) {
      events.push({
        addedLabels: added.map((id) => ({ id, name: labelNames.get(id) })),
        event: "labelAdded",
        issue,
      })
    }
  }

  if (
    updatedFrom.stateId !== undefined &&
    issue.stateId &&
    updatedFrom.stateId !== issue.stateId
  ) {
    events.push({ event: "statusChanged", issue })
  }

  return { events, organizationId: parsed.organizationId }
}
