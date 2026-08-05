import type { ExternalFactoryWaitTrigger } from "@/convex/lib/integrationTriggers"

export type ExternalWebhookProvider = ExternalFactoryWaitTrigger["provider"]

export type NormalizedExternalWebhookEvent = {
  eventKey: string
  eventName: string
  eventVars: Record<string, string>
}

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

function valueAt(value: unknown, path: string): unknown {
  let current = value
  for (const segment of path.split(".")) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)]
    } else {
      current = object(current)[segment]
    }
  }
  return current
}

function stringAt(value: unknown, ...paths: string[]) {
  for (const path of paths) {
    const candidate = valueAt(value, path)
    if (
      (typeof candidate === "string" || typeof candidate === "number") &&
      String(candidate).trim()
    ) {
      return String(candidate).trim()
    }
  }
  return ""
}

function arrayStrings(value: unknown, ...paths: string[]) {
  for (const path of paths) {
    const candidate = valueAt(value, path)
    if (Array.isArray(candidate)) {
      return candidate
        .map((item) =>
          typeof item === "string" || typeof item === "number"
            ? String(item).trim()
            : stringAt(item, "name", "key")
        )
        .filter(Boolean)
    }
  }
  return []
}

function compactVars(vars: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(vars)
      .filter(([, value]) => value)
      .map(([name, value]) => [name, value.slice(0, 4_000)])
  )
}

function normalizedEventName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9._:-]/g, "_")
    .slice(0, 128)
}

function safeEventKey(value: string, fallback: string) {
  return (value.trim() || fallback).slice(0, 400)
}

function sentryEvent(
  payload: unknown,
  headers: Headers,
  fallbackEventKey: string
): NormalizedExternalWebhookEvent | null {
  const resource =
    headers.get("sentry-hook-resource")?.trim().toLowerCase() ||
    stringAt(payload, "resource").toLowerCase()
  const action = stringAt(payload, "action").toLowerCase()
  const explicitEvent = stringAt(payload, "event_type", "eventType")
  const eventName = normalizedEventName(
    explicitEvent || [resource, action || "updated"].filter(Boolean).join(".")
  )
  if (!eventName) return null

  const project = stringAt(
    payload,
    "data.issue.project.slug",
    "data.issue.project.name",
    "data.event.project",
    "project.slug",
    "project"
  )
  const organization = stringAt(
    payload,
    "organization.slug",
    "organization.name",
    "installation.organization.slug",
    "installation.organization.name"
  )
  const title = stringAt(
    payload,
    "data.issue.title",
    "data.event.title",
    "data.metric_alert.title",
    "data.event_alert.title"
  )
  const status = stringAt(
    payload,
    "data.issue.status",
    "data.metric_alert.status",
    "data.event_alert.status"
  )
  const severity = stringAt(
    payload,
    "data.event.level",
    "data.issue.level",
    "data.issue.metadata.type"
  )
  const issueId = stringAt(payload, "data.issue.id", "data.event.issue_id")
  const url = stringAt(
    payload,
    "data.issue.web_url",
    "data.issue.permalink",
    "data.event.web_url",
    "url"
  )
  const text = stringAt(
    payload,
    "data.event.message",
    "data.issue.metadata.value",
    "data.issue.culprit"
  )
  const eventVars = compactVars({
    actor: stringAt(payload, "actor.name", "actor.email", "actor.id"),
    environment: stringAt(payload, "data.event.environment", "environment"),
    event: eventName,
    issueId,
    organization,
    project,
    severity,
    source: "sentry",
    status,
    summary: `Sentry ${eventName}${project ? ` in ${project}` : ""}${title ? `: ${title}` : ""}`,
    text,
    title,
    url,
  })

  return {
    eventKey: safeEventKey(
      headers.get("sentry-hook-request-id")?.trim() ||
        stringAt(payload, "id", "data.event.id", "data.issue.id"),
      fallbackEventKey
    ),
    eventName,
    eventVars,
  }
}

function datadogEvent(
  payload: unknown,
  headers: Headers,
  fallbackEventKey: string
): NormalizedExternalWebhookEvent | null {
  const transition = stringAt(
    payload,
    "ALERT_TRANSITION",
    "alert_transition",
    "transition",
    "status",
    "alert_type"
  )
  const explicitEvent = stringAt(
    payload,
    "EVENT_TYPE",
    "event_type",
    "eventType"
  )
  const eventName = normalizedEventName(
    explicitEvent || (transition ? `monitor.${transition}` : "monitor.updated")
  )
  if (!eventName) return null

  const title = stringAt(
    payload,
    "ALERT_TITLE",
    "alert_title",
    "title",
    "event.title"
  )
  const tags = [
    ...arrayStrings(payload, "TAGS", "tags"),
    ...stringAt(payload, "TAGS", "tags")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  ]
  const tagValue = (name: string) =>
    tags
      .find((tag) => tag.toLowerCase().startsWith(`${name}:`))
      ?.slice(name.length + 1) ?? ""
  const status = normalizedEventName(transition)
  const eventVars = compactVars({
    environment: stringAt(payload, "environment", "env") || tagValue("env"),
    event: eventName,
    monitorId: stringAt(payload, "ALERT_ID", "alert_id", "monitor_id", "id"),
    organization: stringAt(payload, "ORG_ID", "org_id", "organization"),
    service: stringAt(payload, "service") || tagValue("service"),
    severity: stringAt(payload, "priority", "severity") || tagValue("severity"),
    source: "datadog",
    status,
    summary: `Datadog ${eventName}${title ? `: ${title}` : ""}`,
    tags: [...new Set(tags)].join(", "),
    team: stringAt(payload, "team") || tagValue("team"),
    text: stringAt(payload, "EVENT_MSG", "event_msg", "message", "body"),
    title,
    url: stringAt(payload, "LINK", "link", "url"),
  })
  return {
    eventKey: safeEventKey(
      headers.get("x-datadog-webhook-id")?.trim() ||
        stringAt(payload, "EVENT_ID", "event_id", "id"),
      fallbackEventKey
    ),
    eventName,
    eventVars,
  }
}

function pagerDutyEvent(
  payload: unknown,
  headers: Headers,
  fallbackEventKey: string
): NormalizedExternalWebhookEvent | null {
  const eventName = normalizedEventName(
    stringAt(payload, "event.event_type", "event_type")
  )
  if (!eventName) return null

  const title = stringAt(
    payload,
    "event.data.title",
    "event.data.summary",
    "event.data.incident.title"
  )
  const eventVars = compactVars({
    actor: stringAt(
      payload,
      "event.agent.summary",
      "event.agent.name",
      "event.data.assignments.0.assignee.summary"
    ),
    event: eventName,
    incidentId: stringAt(payload, "event.data.id", "event.id"),
    service: stringAt(
      payload,
      "event.data.service.summary",
      "event.data.service.id"
    ),
    source: "pagerduty",
    status: stringAt(payload, "event.data.status"),
    summary: `PagerDuty ${eventName}${title ? `: ${title}` : ""}`,
    team: stringAt(payload, "event.data.teams.0.summary"),
    text: stringAt(payload, "event.data.description", "event.data.summary"),
    title,
    urgency: stringAt(payload, "event.data.urgency"),
    url: stringAt(
      payload,
      "event.data.html_url",
      "event.data.self",
      "event.data.incident.html_url"
    ),
  })
  return {
    eventKey: safeEventKey(
      headers.get("x-pagerduty-delivery-id")?.trim() ||
        stringAt(payload, "event.id", "event.data.id"),
      fallbackEventKey
    ),
    eventName,
    eventVars,
  }
}

function genericWebhookEvent(
  payload: unknown,
  headers: Headers,
  fallbackEventKey: string
): NormalizedExternalWebhookEvent | null {
  const eventName = normalizedEventName(
    stringAt(payload, "event", "event_type", "eventType", "type")
  )
  if (!eventName) return null

  const topLevelVars: Record<string, string> = {}
  for (const [name, value] of Object.entries(object(payload))) {
    if (
      /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) &&
      (typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean")
    ) {
      topLevelVars[name] = String(value)
    }
  }
  const title = stringAt(payload, "title", "data.title", "subject")
  const eventVars = compactVars({
    ...topLevelVars,
    environment: stringAt(payload, "environment", "data.environment"),
    event: eventName,
    organization: stringAt(payload, "organization", "data.organization"),
    project: stringAt(payload, "project", "data.project"),
    service: stringAt(payload, "service", "data.service"),
    severity: stringAt(payload, "severity", "data.severity", "level"),
    source: "webhook",
    status: stringAt(payload, "status", "data.status"),
    summary: `Webhook ${eventName}${title ? `: ${title}` : ""}`,
    team: stringAt(payload, "team", "data.team"),
    text: stringAt(payload, "text", "message", "body", "data.message"),
    title,
    urgency: stringAt(payload, "urgency", "data.urgency"),
    url: stringAt(payload, "url", "link", "data.url"),
  })
  return {
    eventKey: safeEventKey(
      headers.get("x-webhook-id")?.trim() ||
        stringAt(payload, "id", "event_id", "delivery_id"),
      fallbackEventKey
    ),
    eventName,
    eventVars,
  }
}

export function normalizeExternalWebhookEvent(
  provider: ExternalWebhookProvider,
  payload: unknown,
  headers: Headers,
  fallbackEventKey: string
): NormalizedExternalWebhookEvent | null {
  if (provider === "sentry") {
    return sentryEvent(payload, headers, fallbackEventKey)
  }
  if (provider === "datadog") {
    return datadogEvent(payload, headers, fallbackEventKey)
  }
  if (provider === "pagerduty") {
    return pagerDutyEvent(payload, headers, fallbackEventKey)
  }
  if (provider === "webhook") {
    return genericWebhookEvent(payload, headers, fallbackEventKey)
  }
  return null
}

export function externalWebhookEventMatches(
  trigger: ExternalFactoryWaitTrigger,
  eventName: string,
  eventVars: Record<string, string>
) {
  if (trigger.event !== eventName) return false
  const comparableVars = new Map(
    Object.entries(eventVars).map(([name, value]) => [
      name.toLowerCase(),
      value.trim().toLowerCase(),
    ])
  )
  return Object.entries(trigger.filters ?? {}).every(
    ([name, expected]) =>
      comparableVars.get(name.toLowerCase()) === expected.trim().toLowerCase()
  )
}
