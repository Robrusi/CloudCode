import { createHmac, timingSafeEqual } from "node:crypto"

import type { LinearIssueAutomationEvent } from "@/lib/integrations/events"

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
