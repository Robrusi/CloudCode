import { createHmac, timingSafeEqual } from "node:crypto"

import type {
  IntegrationChatEventPayload,
  LinearAutomationEvent,
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
    assignee?: { id?: string; name?: string }
    assigneeId?: string | null
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
    assigneeId?: string | null
    labelIds?: string[]
    stateId?: string
  }
}

type LinearCommentPayload = {
  action?: string
  actor?: {
    id?: string
    name?: string
    type?: string
  }
  data?: {
    body?: string
    id?: string
    issueId?: string
    userId?: string
  }
  organizationId?: string
  type?: string
  url?: string
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

/** Extracts automation-relevant Issue changes and human-authored Comment
 * creations from a raw Linear webhook payload. Unrelated events, comment
 * edits, and app/integration-authored comments return an empty list. */
export function parseLinearAutomationEvents(payload: unknown): {
  events: LinearAutomationEvent[]
  organizationId?: string
} {
  const commentPayload = payload as LinearCommentPayload
  if (
    commentPayload?.type === "Comment" &&
    commentPayload.action === "create"
  ) {
    const data = commentPayload.data
    const actorType = commentPayload.actor?.type?.toLowerCase()
    const authorId = commentPayload.actor?.id ?? data?.userId
    if (
      !data?.id ||
      !data.issueId ||
      !authorId ||
      (actorType && actorType !== "user")
    ) {
      return { events: [] }
    }
    return {
      events: [
        {
          comment: {
            authorId,
            authorName: commentPayload.actor?.name,
            body: data.body,
            id: data.id,
            url: commentPayload.url,
          },
          event: "commentCreated",
          issue: { id: data.issueId },
        },
      ],
      organizationId: commentPayload.organizationId,
    }
  }

  const parsed = payload as LinearIssuePayload
  if (
    !parsed ||
    parsed.type !== "Issue" ||
    (parsed.action !== "create" && parsed.action !== "update")
  ) {
    return { events: [] }
  }
  const data = parsed.data
  const updatedFrom = parsed.updatedFrom
  if (!data?.id) return { events: [] }

  const labelNames = new Map(
    (data.labels ?? [])
      .filter((label): label is { id: string; name?: string } =>
        Boolean(label.id)
      )
      .map((label) => [label.id, label.name])
  )
  const assigneeId = data.assigneeId ?? data.assignee?.id ?? undefined
  const issue = {
    assigneeId,
    assigneeName: data.assignee?.name,
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

  const events: LinearAutomationEvent[] = []

  if (parsed.action === "create") {
    return {
      events: [{ event: "issueCreated", issue }],
      organizationId: parsed.organizationId,
    }
  }

  if (!updatedFrom) return { events: [] }

  if (
    updatedFrom.assigneeId !== undefined &&
    assigneeId &&
    updatedFrom.assigneeId !== assigneeId
  ) {
    events.push({ event: "issueAssigned", issue })
  }

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
