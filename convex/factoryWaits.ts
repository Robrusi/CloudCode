import { v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { activeRunForThread } from "./lib/codexRunLifecycle"
import {
  factoryAccessArgs,
  requireActiveFactoryRunAccess,
  requireFactoryRunAccess,
} from "./lib/factoryAccess"
import type { FactoryRunCreated } from "./lib/factoryRuns"
import { maybeCreateFactoryWakeRun } from "./lib/factoryWake"
import {
  ACTIVE_WAIT_STATUSES,
  activeWaitsForThread,
  clampWaitTtlMs,
  closeWait,
  deletePendingWaitEvents,
  insertWaitEvent,
  insertWaitKeys,
  isActiveWaitStatus,
  pendingEventCountForWait,
  recordWaitEvent,
  requireWaitCapacity,
} from "./lib/factoryWaits"
import {
  GITHUB_WAIT_EVENTS,
  LINEAR_WAIT_EVENTS,
  SLACK_WAIT_EVENTS,
  githubInstallationWaitSourceKey,
  linearWaitSourceKey,
  slackWaitEventSourceKey,
  slackWaitSourceKeys,
} from "./lib/factoryWaitTriggers"
import {
  enabledInstallationForUser,
  installationForProviderExternal,
} from "./lib/integrationInstallations"
import {
  externalEventTriggerSourceKey,
  externalFactoryWaitProvider,
  githubInstallationEventTriggerSourceKey,
  linearEventTriggerSourceKey,
  type FactoryEventWaitTrigger,
  type ExternalFactoryWaitProvider,
} from "./lib/integrationTriggers"
import { getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"
import {
  FACTORY_MAX_ACTIVE_WAITS_PER_SOURCE,
  FACTORY_MAX_WEBHOOK_ENDPOINTS_PER_USER,
} from "@/lib/factory/limits"
import {
  assertWaitKindArguments,
  normalizeExternalEventConfig,
  normalizeGitHubEventTrigger,
  normalizeLinearEventTrigger,
  validateLinearIssueId,
  validateSlackWaitTarget,
  type FactoryWaitKind,
  type FactoryWaitRequestFields,
} from "@/lib/factory/wait-config"
import { canonicalGitHubRepoUrl } from "@/lib/github/repo"

/** Reported events are kept this long for webhook dedupe, then swept.
 * Pending events on threads that never free up (user-canceled) share the
 * retention so they cannot accumulate forever. */
const WAIT_EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000
const WAIT_INGRESS_PAYLOAD_MAX = 256 * 1024

/** Pending events older than this on an idle thread mean the worker that
 * recorded them died before dispatching the wake; the tick redelivers. */
const WAIT_WAKE_RECOVERY_AGE_MS = 5 * 60_000

const WAKE_RECOVERY_SCAN_LIMIT = 500
const WAKE_RECOVERY_DELIVERY_LIMIT = 20

const EXPIRE_SWEEP_DEFAULT_LIMIT = 50
const LEGACY_WAIT_CLEANUP_LIMIT = 100
const MATCH_SOURCE_KEYS_MAX = 25
const GITHUB_WAIT_INSTALLATION_MAX = 50

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function externalProviderForKind(
  kind: FactoryWaitKind
): ExternalFactoryWaitProvider | undefined {
  if (kind === "sentry_event") return "sentry"
  if (kind === "datadog_event") return "datadog"
  if (kind === "pagerduty_event") return "pagerduty"
  if (kind === "webhook_event") return "webhook"
  return undefined
}

async function resolveOrCreateWebhookEndpoint(
  ctx: MutationCtx,
  userId: Id<"users">,
  provider: ExternalFactoryWaitProvider,
  endpointId?: Id<"factoryWebhookEndpoints">
) {
  if (endpointId) {
    const endpoint = await ctx.db.get(endpointId)
    if (
      !endpoint ||
      endpoint.userId !== userId ||
      endpoint.provider !== provider
    ) {
      throw new Error("Webhook endpoint not found for this provider.")
    }
    return { endpoint, webhookToken: undefined }
  }

  const existing = await ctx.db
    .query("factoryWebhookEndpoints")
    .withIndex("by_user_provider", (q) =>
      q.eq("userId", userId).eq("provider", provider)
    )
    .first()
  if (existing) return { endpoint: existing, webhookToken: undefined }

  const endpointCount = (
    await ctx.db
      .query("factoryWebhookEndpoints")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(FACTORY_MAX_WEBHOOK_ENDPOINTS_PER_USER)
  ).length
  if (endpointCount >= FACTORY_MAX_WEBHOOK_ENDPOINTS_PER_USER) {
    throw new Error("Too many Factory webhook endpoints are configured.")
  }

  const webhookToken = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`
  const now = Date.now()
  const createdId = await ctx.db.insert("factoryWebhookEndpoints", {
    createdAt: now,
    provider,
    tokenHash: await sha256Hex(webhookToken),
    updatedAt: now,
    userId,
  })
  const endpoint = await ctx.db.get(createdId)
  if (!endpoint) throw new Error("Unable to create webhook endpoint.")
  return { endpoint, webhookToken }
}

async function githubWaitInstallationIds(
  ctx: MutationCtx,
  userId: Id<"users">
) {
  const installations = await ctx.db
    .query("githubAppInstallations")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(GITHUB_WAIT_INSTALLATION_MAX + 1)
  if (installations.length === 0) {
    throw new Error(
      "Install the GitHub App before creating a GitHub Factory wait."
    )
  }
  if (installations.length > GITHUB_WAIT_INSTALLATION_MAX) {
    throw new Error(
      "Too many GitHub App installations are connected to create a bounded wait."
    )
  }
  return [...new Set(installations.map((row) => row.installationId))]
}

function parseWaitEvents(
  values: string[] | undefined,
  allowed: readonly string[]
): string[] {
  if (!values) return [...allowed]
  const unique = [...new Set(values.map((value) => value.trim()))].filter(
    Boolean
  )
  for (const value of unique) {
    if (!allowed.includes(value)) {
      throw new Error(`events must be among ${allowed.join(", ")}.`)
    }
  }
  return unique.length ? unique : [...allowed]
}

function prNumberFromUrl(prUrl: string, repoUrl: string): number {
  const match = prUrl
    .trim()
    .match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/)
  if (!match) {
    throw new Error(
      "prUrl must look like https://github.com/{owner}/{repo}/pull/{number}."
    )
  }
  const runRepo = canonicalGitHubRepoUrl(repoUrl)?.toLowerCase()
  const urlRepo = canonicalGitHubRepoUrl(
    `https://github.com/${match[1]}/${match[2]}`
  )?.toLowerCase()
  if (runRepo && urlRepo && runRepo !== urlRepo) {
    throw new Error(
      "wait_create can only watch pull requests on this run's repository."
    )
  }
  return Number(match[3])
}

function formatWaitDuration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"}`
}

function waitSummary(wait: Doc<"factoryWaits">) {
  return {
    channelId: wait.messageChannelId,
    createdAt: wait.createdAt,
    eventTrigger: wait.eventTrigger,
    events: wait.events,
    expiresAt: wait.expiresAt,
    issueId: wait.linearIssueId,
    messageTs: wait.messageTs,
    note: wait.note,
    prNumber: wait.prNumber,
    provider: wait.provider,
    status: wait.status,
    statusReason: wait.statusReason,
    threadTs: wait.messageThreadTs,
    waitId: wait._id,
  }
}

async function matchWaitsBySourceKeys(
  ctx: QueryCtx | MutationCtx,
  sourceKeys: string[]
) {
  const keys = [...new Set(sourceKeys)].slice(0, MATCH_SOURCE_KEYS_MAX)
  const rowsPerKey = await Promise.all(
    keys.map((sourceKey) =>
      ctx.db
        .query("factoryWaitKeys")
        .withIndex("by_source", (q) => q.eq("sourceKey", sourceKey))
        .take(FACTORY_MAX_ACTIVE_WAITS_PER_SOURCE)
    )
  )
  const waitIds = [...new Set(rowsPerKey.flat().map((row) => row.waitId))]
  const waits = await Promise.all(waitIds.map((waitId) => ctx.db.get(waitId)))

  return waits
    .filter((wait): wait is Doc<"factoryWaits"> =>
      Boolean(wait && wait.status === "armed")
    )
    .map((wait) => ({
      eventTrigger: wait.eventTrigger,
      events: wait.events,
      note: wait.note,
      provider: wait.provider,
      sourceKeys: wait.sourceKeys,
      threadId: wait.threadId,
      userId: wait.userId,
      waitId: wait._id,
    }))
}

// ---------------------------------------------------------------------------
// Tool-facing functions (authenticated by the per-run access token).
// ---------------------------------------------------------------------------

export const createWait = mutation({
  args: {
    ...factoryAccessArgs,
    actorLogin: v.optional(v.string()),
    assigneeId: v.optional(v.string()),
    assigneeName: v.optional(v.string()),
    branch: v.optional(v.string()),
    channelId: v.optional(v.string()),
    commentAuthorIds: v.optional(v.array(v.string())),
    commentAuthorMode: v.optional(
      v.union(v.literal("any"), v.literal("include"), v.literal("exclude"))
    ),
    commentAuthorNames: v.optional(v.array(v.string())),
    endpointId: v.optional(v.id("factoryWebhookEndpoints")),
    event: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    filters: v.optional(v.record(v.string(), v.string())),
    issueId: v.optional(v.string()),
    kind: v.union(
      v.literal("slack_thread"),
      v.literal("github_pr"),
      v.literal("github_event"),
      v.literal("linear_issue"),
      v.literal("linear_event"),
      v.literal("sentry_event"),
      v.literal("datadog_event"),
      v.literal("pagerduty_event"),
      v.literal("webhook_event")
    ),
    labelId: v.optional(v.string()),
    labelName: v.optional(v.string()),
    messageTs: v.optional(v.string()),
    note: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    prUrl: v.optional(v.string()),
    stateId: v.optional(v.string()),
    stateName: v.optional(v.string()),
    teamId: v.optional(v.string()),
    teamName: v.optional(v.string()),
    threadTs: v.optional(v.string()),
    ttlSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await requireActiveFactoryRunAccess(ctx, args)
    const requestFields: FactoryWaitRequestFields = {
      actorLogin: args.actorLogin,
      assigneeId: args.assigneeId,
      assigneeName: args.assigneeName,
      branch: args.branch,
      channelId: args.channelId,
      commentAuthorIds: args.commentAuthorIds,
      commentAuthorMode: args.commentAuthorMode,
      commentAuthorNames: args.commentAuthorNames,
      endpointId: args.endpointId,
      event: args.event,
      events: args.events,
      filters: args.filters,
      issueId: args.issueId,
      labelId: args.labelId,
      labelName: args.labelName,
      messageTs: args.messageTs,
      note: args.note,
      prNumber: args.prNumber,
      prUrl: args.prUrl,
      stateId: args.stateId,
      stateName: args.stateName,
      teamId: args.teamId,
      teamName: args.teamName,
      threadTs: args.threadTs,
      ttlSeconds: args.ttlSeconds,
    }
    assertWaitKindArguments(args.kind, requestFields)
    await requireWaitCapacity(ctx, run.threadId, run.userId)
    const now = Date.now()
    const expiresAt = now + clampWaitTtlMs(args.ttlSeconds)
    const note = args.note?.trim() || undefined
    if (note && note.length > 500) {
      throw new Error("note must be at most 500 characters.")
    }
    let webhookSetup:
      | {
          endpointId: Id<"factoryWebhookEndpoints">
          webhookPath?: string
        }
      | undefined

    let target: {
      eventTrigger?: FactoryEventWaitTrigger
      events: string[]
      installationId?: Id<"integrationInstallations">
      linearIssueId?: string
      messageChannelId?: string
      messageThreadTs?: string
      messageTs?: string
      prNumber?: number
      provider: Doc<"factoryWaits">["provider"]
      repoUrl?: string
      sourceKeys: string[]
    }

    if (args.kind === "slack_thread") {
      if (args.event !== undefined) {
        throw new Error("slack_thread waits use events, not event.")
      }
      const channelId = args.channelId?.trim()
      const messageTs = args.messageTs?.trim()
      const threadTs = args.threadTs?.trim() || undefined
      if (!channelId || !messageTs) {
        throw new Error(
          "channelId and messageTs are required for slack_thread waits."
        )
      }
      validateSlackWaitTarget(channelId, messageTs, threadTs)
      const installation = await enabledInstallationForUser(
        ctx,
        run.userId,
        "slack"
      )
      if (!installation) {
        throw new Error("No enabled Slack workspace is connected.")
      }
      target = {
        events: parseWaitEvents(args.events, SLACK_WAIT_EVENTS),
        installationId: installation._id,
        messageChannelId: channelId,
        messageThreadTs: threadTs,
        messageTs,
        provider: "slack",
        sourceKeys: slackWaitSourceKeys({
          channelId,
          installationId: installation._id,
          messageTs,
          threadTs,
        }),
      }
    } else if (args.kind === "github_pr") {
      if (args.event !== undefined) {
        throw new Error("github_pr waits use events, not event.")
      }
      const prNumber =
        args.prNumber ??
        (args.prUrl ? prNumberFromUrl(args.prUrl, run.repoUrl) : undefined)
      if (!prNumber || !Number.isInteger(prNumber) || prNumber <= 0) {
        throw new Error("prNumber (or prUrl) is required for github_pr waits.")
      }
      const installationIds = await githubWaitInstallationIds(ctx, run.userId)
      target = {
        events: parseWaitEvents(args.events, GITHUB_WAIT_EVENTS),
        prNumber,
        provider: "github",
        repoUrl: run.repoUrl,
        sourceKeys: installationIds.map((installationId) =>
          githubInstallationWaitSourceKey(installationId, run.repoUrl, prNumber)
        ),
      }
    } else if (args.kind === "github_event") {
      if (args.events !== undefined) {
        throw new Error(
          "github_event waits use the singular event field, not events."
        )
      }
      const eventTrigger = normalizeGitHubEventTrigger(args)
      const installationIds = await githubWaitInstallationIds(ctx, run.userId)
      target = {
        eventTrigger,
        events: [eventTrigger.event],
        provider: "github",
        repoUrl: run.repoUrl,
        sourceKeys: installationIds.map((installationId) =>
          githubInstallationEventTriggerSourceKey(
            installationId,
            run.repoUrl,
            eventTrigger.event
          )
        ),
      }
    } else if (args.kind === "linear_issue") {
      if (args.event !== undefined) {
        throw new Error("linear_issue waits use events, not event.")
      }
      const issueId = args.issueId?.trim()
      if (!issueId) {
        throw new Error("issueId is required for linear_issue waits.")
      }
      validateLinearIssueId(issueId)
      const installation = await enabledInstallationForUser(
        ctx,
        run.userId,
        "linear"
      )
      if (!installation) {
        throw new Error("No enabled Linear workspace is connected.")
      }
      target = {
        events: parseWaitEvents(args.events, LINEAR_WAIT_EVENTS),
        installationId: installation._id,
        linearIssueId: issueId,
        provider: "linear",
        sourceKeys: [linearWaitSourceKey(installation._id, issueId)],
      }
    } else if (args.kind === "linear_event") {
      if (args.events !== undefined) {
        throw new Error(
          "linear_event waits use the singular event field, not events."
        )
      }
      const installation = await enabledInstallationForUser(
        ctx,
        run.userId,
        "linear"
      )
      if (!installation) {
        throw new Error("No enabled Linear workspace is connected.")
      }
      const eventTrigger = {
        ...normalizeLinearEventTrigger(args),
        installationId: installation._id,
      }
      target = {
        eventTrigger,
        events: [eventTrigger.event],
        installationId: installation._id,
        provider: "linear",
        sourceKeys: [
          linearEventTriggerSourceKey(installation._id, eventTrigger.event),
        ],
      }
    } else {
      const provider = externalProviderForKind(args.kind)
      if (!provider) throw new Error("Unsupported external wait provider.")
      const normalized = normalizeExternalEventConfig(args)
      const resolved = await resolveOrCreateWebhookEndpoint(
        ctx,
        run.userId,
        provider,
        args.endpointId
      )
      const eventTrigger = {
        endpointId: resolved.endpoint._id,
        event: normalized.event,
        ...(Object.keys(normalized.filters).length
          ? { filters: normalized.filters }
          : {}),
        kind: "external" as const,
        provider,
      }
      target = {
        eventTrigger,
        events: [normalized.event],
        provider: "external",
        sourceKeys: [
          externalEventTriggerSourceKey(
            resolved.endpoint._id,
            normalized.event
          ),
        ],
      }
      webhookSetup = {
        endpointId: resolved.endpoint._id,
        ...(resolved.webhookToken
          ? {
              webhookPath: `/api/factory/webhooks/${provider}/${resolved.endpoint._id}/${resolved.webhookToken}`,
            }
          : {}),
      }
    }

    const waitId = await ctx.db.insert("factoryWaits", {
      createdAt: now,
      createdByRunId: run._id,
      ...(target.eventTrigger ? { eventTrigger: target.eventTrigger } : {}),
      events: target.events,
      expiresAt,
      ...(target.installationId
        ? { installationId: target.installationId }
        : {}),
      ...(target.linearIssueId ? { linearIssueId: target.linearIssueId } : {}),
      ...(target.messageChannelId
        ? { messageChannelId: target.messageChannelId }
        : {}),
      ...(target.messageThreadTs
        ? { messageThreadTs: target.messageThreadTs }
        : {}),
      ...(target.messageTs ? { messageTs: target.messageTs } : {}),
      ...(note ? { note } : {}),
      ...(target.prNumber !== undefined ? { prNumber: target.prNumber } : {}),
      provider: target.provider,
      ...(target.repoUrl ? { repoUrl: target.repoUrl } : {}),
      sourceKeys: target.sourceKeys,
      status: "armed",
      threadId: run.threadId,
      updatedAt: now,
      userId: run.userId,
    })
    await insertWaitKeys(
      ctx,
      { _id: waitId, threadId: run.threadId, userId: run.userId },
      target.sourceKeys
    )

    return {
      eventTrigger: target.eventTrigger,
      events: target.events,
      expiresAt,
      status: "armed",
      waitId,
      ...webhookSetup,
    }
  },
})

export const listWebhookEndpoints = query({
  args: factoryAccessArgs,
  handler: async (ctx, args) => {
    const run = await requireFactoryRunAccess(ctx, args)
    const endpoints = await ctx.db
      .query("factoryWebhookEndpoints")
      .withIndex("by_user", (q) => q.eq("userId", run.userId))
      .take(FACTORY_MAX_WEBHOOK_ENDPOINTS_PER_USER)
    return endpoints.map((endpoint) => ({
      endpointId: endpoint._id,
      lastReceivedAt: endpoint.lastReceivedAt,
      provider: endpoint.provider,
    }))
  },
})

export const rotateWebhookEndpoint = mutation({
  args: {
    ...factoryAccessArgs,
    provider: externalFactoryWaitProvider,
  },
  handler: async (ctx, args) => {
    const run = await requireActiveFactoryRunAccess(ctx, args)
    const endpoint = await ctx.db
      .query("factoryWebhookEndpoints")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", run.userId).eq("provider", args.provider)
      )
      .first()
    if (!endpoint) {
      throw new Error(
        `Create a ${args.provider}_event wait before rotating its endpoint.`
      )
    }
    const webhookToken = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`
    await ctx.db.patch(endpoint._id, {
      tokenHash: await sha256Hex(webhookToken),
      updatedAt: Date.now(),
    })
    return {
      endpointId: endpoint._id,
      provider: endpoint.provider,
      webhookPath: `/api/factory/webhooks/${endpoint.provider}/${endpoint._id}/${webhookToken}`,
    }
  },
})

export const listWaits = query({
  args: factoryAccessArgs,
  handler: async (ctx, args) => {
    const run = await requireFactoryRunAccess(ctx, args)
    const waits = await activeWaitsForThread(ctx, run.threadId)

    return await Promise.all(
      waits.map(async (wait) => ({
        ...waitSummary(wait),
        pendingEvents: await pendingEventCountForWait(ctx, wait._id),
      }))
    )
  },
})

export const cancelWait = mutation({
  args: {
    ...factoryAccessArgs,
    waitId: v.id("factoryWaits"),
  },
  handler: async (ctx, args) => {
    const run = await requireActiveFactoryRunAccess(ctx, args)
    const wait = await ctx.db.get(args.waitId)
    if (!wait || wait.userId !== run.userId || wait.threadId !== run.threadId) {
      throw new Error("Wait not found.")
    }
    if (!isActiveWaitStatus(wait.status)) {
      return { canceled: false, status: wait.status }
    }

    await closeWait(ctx, wait, "canceled", "Canceled with wait_cancel.")
    // A canceled wait must not wake the thread later: drop what it queued.
    await deletePendingWaitEvents(ctx, wait._id)

    return { canceled: true, status: "canceled" as const }
  },
})

// ---------------------------------------------------------------------------
// UI query and actions.
// ---------------------------------------------------------------------------

/** Active waits on a thread for the chat UI, which renders them like a
 * queued message ("waiting on a Slack reply…"). */
export const listThreadWaits = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== user._id) return []

    const waits = await activeWaitsForThread(ctx, args.threadId)
    return waits.map(waitSummary)
  },
})

async function requireOwnedWait(
  ctx: QueryCtx | MutationCtx,
  waitId: Id<"factoryWaits">
) {
  const user = await getCurrentUser(ctx)
  if (!user) throw new Error("Not signed in.")
  const wait = await ctx.db.get(waitId)
  if (!wait || wait.userId !== user._id) throw new Error("Wait not found.")
  return wait
}

/** Cancels a wait from the chat UI. Silent by design, matching the agent's
 * own wait_cancel semantics: the thread stays parked and the user re-engages
 * it by messaging when they want it moving again. */
export const userCancelWait = mutation({
  args: { waitId: v.id("factoryWaits") },
  handler: async (ctx, args) => {
    const wait = await requireOwnedWait(ctx, args.waitId)
    if (!isActiveWaitStatus(wait.status)) {
      return { canceled: false, status: wait.status }
    }

    await closeWait(ctx, wait, "canceled", "Canceled by the user in the chat.")
    // A canceled wait must not wake the thread later: drop what it queued.
    await deletePendingWaitEvents(ctx, wait._id)

    return { canceled: true, status: "canceled" as const }
  },
})

// ---------------------------------------------------------------------------
// Worker functions (Trigger tasks and webhook routes).
// ---------------------------------------------------------------------------

export const workerClaimWebhookEndpoint = mutation({
  args: {
    endpointId: v.string(),
    provider: externalFactoryWaitProvider,
    tokenHash: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const endpointId = ctx.db.normalizeId(
      "factoryWebhookEndpoints",
      args.endpointId
    )
    if (!endpointId) return { authenticated: false as const }
    const endpoint = await ctx.db.get(endpointId)
    if (
      !endpoint ||
      endpoint.provider !== args.provider ||
      endpoint.tokenHash !== args.tokenHash
    ) {
      return { authenticated: false as const }
    }
    const receivedAt = Date.now()
    await ctx.db.patch(endpoint._id, {
      lastReceivedAt: receivedAt,
      updatedAt: receivedAt,
    })
    return {
      authenticated: true as const,
      endpointId: endpoint._id,
      receivedAt,
    }
  },
})

export const workerEnqueueWaitIngress = mutation({
  args: {
    dedupeKey: v.string(),
    payloadJson: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    if (!args.dedupeKey.trim() || args.dedupeKey.length > 500) {
      throw new Error("Invalid Factory wait ingress dedupe key.")
    }
    if (
      !args.payloadJson ||
      new TextEncoder().encode(args.payloadJson).byteLength >
        WAIT_INGRESS_PAYLOAD_MAX
    ) {
      throw new Error("Factory wait ingress payload is too large.")
    }
    const existing = await ctx.db
      .query("factoryWaitIngressEvents")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", args.dedupeKey))
      .first()
    if (existing) {
      return { ingressId: existing._id, status: existing.status }
    }
    const now = Date.now()
    const ingressId = await ctx.db.insert("factoryWaitIngressEvents", {
      createdAt: now,
      dedupeKey: args.dedupeKey,
      payloadJson: args.payloadJson,
      status: "queued",
      updatedAt: now,
    })
    return { ingressId, status: "queued" as const }
  },
})

export const workerGetWaitIngress = query({
  args: {
    ingressId: v.id("factoryWaitIngressEvents"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    return await ctx.db.get(args.ingressId)
  },
})

export const workerCompleteWaitIngress = mutation({
  args: {
    ingressId: v.id("factoryWaitIngressEvents"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const ingress = await ctx.db.get(args.ingressId)
    if (!ingress || ingress.status === "processed") return { completed: false }
    await ctx.db.patch(ingress._id, {
      status: "processed",
      updatedAt: Date.now(),
    })
    return { completed: true }
  },
})

export const workerPendingWaitIngress = query({
  args: {
    limit: v.optional(v.number()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100)
    const edgeLimit = Math.ceil(limit / 2)
    const [oldest, newest] = await Promise.all([
      ctx.db
        .query("factoryWaitIngressEvents")
        .withIndex("by_status_updated", (q) => q.eq("status", "queued"))
        .take(edgeLimit),
      ctx.db
        .query("factoryWaitIngressEvents")
        .withIndex("by_status_updated", (q) => q.eq("status", "queued"))
        .order("desc")
        .take(edgeLimit),
    ])
    return [...new Set([...oldest, ...newest].map((row) => row._id))].slice(
      0,
      limit
    )
  },
})

export const workerMatchExternalWaitEvent = query({
  args: {
    endpointId: v.id("factoryWebhookEndpoints"),
    event: v.string(),
    provider: externalFactoryWaitProvider,
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const endpoint = await ctx.db.get(args.endpointId)
    if (!endpoint || endpoint.provider !== args.provider) return []
    const matches = await matchWaitsBySourceKeys(ctx, [
      externalEventTriggerSourceKey(endpoint._id, args.event),
    ])
    return matches.filter(
      (match) =>
        match.eventTrigger?.kind === "external" &&
        match.eventTrigger.endpointId === endpoint._id &&
        match.eventTrigger.provider === endpoint.provider
    )
  },
})

/** Generic pre-ack matcher: which armed waits listen on any of these source
 * keys? Ordinary webhook traffic costs one indexed lookup per key and
 * nothing more. */
export const workerMatchWaitEvents = query({
  args: {
    githubInstallationId: v.optional(v.string()),
    sourceKeys: v.array(v.string()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const matches = await matchWaitsBySourceKeys(ctx, args.sourceKeys)
    if (!args.githubInstallationId) return matches

    const owners = new Set(
      (
        await ctx.db
          .query("githubAppInstallations")
          .withIndex("by_installation", (q) =>
            q.eq("installationId", args.githubInstallationId!)
          )
          .take(FACTORY_MAX_ACTIVE_WAITS_PER_SOURCE)
      ).map((installation) => installation.userId)
    )
    return matches.filter(
      (match) =>
        match.provider !== "github" ||
        match.sourceKeys.some((sourceKey) =>
          sourceKey.startsWith(`github:${args.githubInstallationId}:`)
        ) ||
        owners.has(match.userId)
    )
  },
})

export const workerMatchSlackWaitEvent = query({
  args: {
    actorUserId: v.optional(v.string()),
    channelId: v.string(),
    event: v.union(v.literal("reply"), v.literal("reaction")),
    externalId: v.string(),
    // Replies match on their thread root ts, reactions on the reacted
    // message's ts — the caller passes the right one.
    messageTs: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const installation = await installationForProviderExternal(
      ctx,
      "slack",
      args.externalId
    )
    if (!installation || !installation.enabled) return []
    // The agent's own reactions (posted through the MCP bot) never wake it.
    if (args.actorUserId && args.actorUserId === installation.botUserId) {
      return []
    }

    const matches = await matchWaitsBySourceKeys(ctx, [
      slackWaitEventSourceKey({
        channelId: args.channelId,
        installationId: installation._id,
        ts: args.messageTs,
      }),
    ])
    return matches.filter((match) => match.events.includes(args.event))
  },
})

export const workerMatchLinearWaitEvent = query({
  args: {
    actorId: v.optional(v.string()),
    event: v.union(
      v.literal("issueCreated"),
      v.literal("issueAssigned"),
      v.literal("labelAdded"),
      v.literal("statusChanged"),
      v.literal("commentCreated")
    ),
    externalId: v.string(),
    issueId: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const installation = await installationForProviderExternal(
      ctx,
      "linear",
      args.externalId
    )
    if (!installation || !installation.enabled) return []
    if (args.actorId && args.actorId === installation.botUserId) return []

    const matches = await matchWaitsBySourceKeys(ctx, [
      linearEventTriggerSourceKey(installation._id, args.event),
      ...(args.event === "commentCreated"
        ? [linearWaitSourceKey(installation._id, args.issueId)]
        : []),
    ])
    return matches.filter((match) =>
      match.eventTrigger?.kind === "linear"
        ? match.events.includes(args.event)
        : args.event === "commentCreated" && match.events.includes("comment")
    )
  },
})

type MatchedWaitEvent = {
  eventKey: string
  eventName: string
  eventVars: Record<string, string>
  externalThreadId?: string
  receivedAt?: number
}

/** Records one matched event on one wait without creating a wake, so a
 * caller with several matches can record them all first and coalesce into
 * one wake per thread. Returns the thread to wake when the event queued. */
async function recordMatchedWaitEvent(
  ctx: MutationCtx,
  waitId: Id<"factoryWaits">,
  event: MatchedWaitEvent
): Promise<{ queued: boolean; reason?: string; threadId?: Id<"threads"> }> {
  const wait = await ctx.db.get(waitId)
  if (!wait) return { queued: false, reason: "gone" }

  // A Slack reply on this thread's own bridged conversation is already
  // delivered as a follow-up run by the integration pipeline; queueing it
  // here would run the thread twice for one message. The wait still counts
  // as answered.
  if (
    wait.provider === "slack" &&
    event.eventName === "reply" &&
    event.externalThreadId &&
    wait.status === "armed"
  ) {
    const bridge = await ctx.db
      .query("integrationThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", wait.threadId))
      .first()
    if (
      bridge &&
      bridge.provider === "slack" &&
      bridge.externalThreadId === event.externalThreadId
    ) {
      await closeWait(
        ctx,
        wait,
        "fired",
        "Answered in the thread's own Slack conversation; delivered by the follow-up run."
      )
      // The follow-up run supersedes anything this wait queued earlier;
      // leaving those events pending would wake the thread a second time.
      await deletePendingWaitEvents(ctx, wait._id)
      return { queued: false, reason: "bridged_follow_up" }
    }
  }

  const result = await recordWaitEvent(ctx, wait, event)
  if (!result.queued) return { queued: false, reason: result.reason }
  return { queued: true, threadId: wait.threadId }
}

const matchedWaitEventArgs = {
  eventKey: v.string(),
  eventName: v.string(),
  eventVars: v.record(v.string(), v.string()),
  externalThreadId: v.optional(v.string()),
  receivedAt: v.optional(v.number()),
}

/** Single-wait variant kept for Trigger workers deployed against the
 * previous protocol; new workers batch through workerRecordWaitEvents. */
export const workerRecordWaitEvent = mutation({
  args: {
    ...matchedWaitEventArgs,
    waitId: v.id("factoryWaits"),
    workerSecret: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    factoryWakeRuns: FactoryRunCreated[]
    queued: boolean
    reason?: string
  }> => {
    requireWorkerSecret(args.workerSecret)

    const result = await recordMatchedWaitEvent(ctx, args.waitId, args)
    if (!result.queued || !result.threadId) {
      return { factoryWakeRuns: [], queued: false, reason: result.reason }
    }

    const wake = await maybeCreateFactoryWakeRun(ctx, result.threadId)
    return { factoryWakeRuns: wake ? [wake] : [], queued: true }
  },
})

/** Records one provider event on every wait it matched, then creates at most
 * one wake per affected thread. Recording per-wait but waking per-thread is
 * what keeps a delivery matching several waits on one thread coalesced into
 * a single continuation run instead of a chain. */
export const workerRecordWaitEvents = mutation({
  args: {
    ...matchedWaitEventArgs,
    waitIds: v.array(v.id("factoryWaits")),
    workerSecret: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ factoryWakeRuns: FactoryRunCreated[]; queued: number }> => {
    requireWorkerSecret(args.workerSecret)

    const threadIds = new Set<Id<"threads">>()
    let queued = 0
    for (const waitId of new Set(args.waitIds)) {
      const result = await recordMatchedWaitEvent(ctx, waitId, args)
      if (result.queued && result.threadId) {
        queued += 1
        threadIds.add(result.threadId)
      }
    }

    const factoryWakeRuns: FactoryRunCreated[] = []
    for (const threadId of threadIds) {
      const wake = await maybeCreateFactoryWakeRun(ctx, threadId)
      if (wake) factoryWakeRuns.push(wake)
    }
    return { factoryWakeRuns, queued }
  },
})

/** Current batch protocol. One provider delivery can satisfy legacy
 * target-specific waits and structured event waits, whose stored event names
 * differ, while still creating at most one wake per affected thread. */
export const workerRecordMatchedWaitEvents = mutation({
  args: {
    eventKey: v.string(),
    eventVars: v.record(v.string(), v.string()),
    externalThreadId: v.optional(v.string()),
    matches: v.array(
      v.object({
        eventName: v.string(),
        waitId: v.id("factoryWaits"),
      })
    ),
    receivedAt: v.optional(v.number()),
    workerSecret: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ factoryWakeRuns: FactoryRunCreated[]; queued: number }> => {
    requireWorkerSecret(args.workerSecret)

    const uniqueMatches = new Map(
      args.matches.map((match) => [String(match.waitId), match])
    )
    const threadIds = new Set<Id<"threads">>()
    let queued = 0
    for (const match of uniqueMatches.values()) {
      const result = await recordMatchedWaitEvent(ctx, match.waitId, {
        eventKey: args.eventKey,
        eventName: match.eventName,
        eventVars: args.eventVars,
        externalThreadId: args.externalThreadId,
        receivedAt: args.receivedAt,
      })
      if (result.queued && result.threadId) {
        queued += 1
        threadIds.add(result.threadId)
      }
    }

    const factoryWakeRuns: FactoryRunCreated[] = []
    for (const threadId of threadIds) {
      const wake = await maybeCreateFactoryWakeRun(ctx, threadId)
      if (wake) factoryWakeRuns.push(wake)
    }
    return { factoryWakeRuns, queued }
  },
})

/** TTL sweep: expires overdue waits and wakes their threads with a timeout
 * event, and garbage-collects old event rows. Runs from the automations
 * tick. */
export const workerExpireWaits = mutation({
  args: {
    limit: v.optional(v.number()),
    now: v.optional(v.number()),
    workerSecret: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ expired: number; factoryWakeRuns: FactoryRunCreated[] }> => {
    requireWorkerSecret(args.workerSecret)
    const now = args.now ?? Date.now()
    const limit = Math.min(
      Math.max(args.limit ?? EXPIRE_SWEEP_DEFAULT_LIMIT, 1),
      100
    )

    const dueByStatus = await Promise.all(
      ACTIVE_WAIT_STATUSES.map((status) =>
        ctx.db
          .query("factoryWaits")
          .withIndex("by_status_expires", (q) =>
            q.eq("status", status).lt("expiresAt", now)
          )
          .take(limit)
      )
    )
    const due = dueByStatus.flat().slice(0, limit)

    const threadIds = new Set<Id<"threads">>()
    for (const wait of due) {
      // A wait that already recorded an event before its deadline was
      // answered, not timed out — its pending event is still waiting behind
      // a busy thread. Close it as fired and deliver only the answer;
      // adding a timeout notice too would contradict it.
      const answered = (await pendingEventCountForWait(ctx, wait._id)) > 0
      if (answered) {
        await closeWait(
          ctx,
          wait,
          "fired",
          "Received an event before expiry; delivered after the deadline."
        )
        threadIds.add(wait.threadId)
        continue
      }

      await closeWait(ctx, wait, "expired", "Timed out with no response.")
      const thread = await ctx.db.get(wait.threadId)
      if (!thread) continue
      await insertWaitEvent(ctx, wait, {
        eventKey: `timeout:${wait._id}`,
        eventVars: {
          event: "timeout",
          summary: `timed out after ${formatWaitDuration(wait.expiresAt - wait.createdAt)} with no response. The wait is closed — decide how to proceed: re-ask, escalate, or continue without the answer.`,
        },
      })
      threadIds.add(wait.threadId)
    }

    // A previous Factory version persisted two states for its retired
    // message-posting workflow. They are deliberately non-active and are
    // canceled here so rolling out this version cannot strand match keys or
    // fail Convex's existing-document schema validation.
    const legacyByStatus = await Promise.all(
      (["arming", "failed"] as const).map((status) =>
        ctx.db
          .query("factoryWaits")
          .withIndex("by_status_expires", (q) => q.eq("status", status))
          .take(LEGACY_WAIT_CLEANUP_LIMIT)
      )
    )
    for (const wait of legacyByStatus.flat()) {
      await closeWait(
        ctx,
        wait,
        "canceled",
        "Canceled while removing a retired Factory wait workflow."
      )
      await deletePendingWaitEvents(ctx, wait._id)
    }

    const factoryWakeRuns: FactoryRunCreated[] = []
    for (const threadId of threadIds) {
      const wake = await maybeCreateFactoryWakeRun(ctx, threadId)
      if (wake) factoryWakeRuns.push(wake)
    }

    // Reported events past retention, plus pending events stuck on threads
    // that never free up (e.g. user-canceled), are swept together. A
    // reported event whose wake run is still stranded (queued, no Trigger
    // run) is kept — it is the only breadcrumb workerRecoverWakeDispatches
    // has, so deleting it would make that wake unrecoverable.
    const cutoff = now - WAIT_EVENT_RETENTION_MS
    const staleByStatus = await Promise.all(
      (["reported", "pending"] as const).map((status) =>
        ctx.db
          .query("factoryWaitEvents")
          .withIndex("by_status_updated", (q) =>
            q.eq("status", status).lt("updatedAt", cutoff)
          )
          .take(100)
      )
    )
    for (const event of staleByStatus.flat()) {
      if (event.status === "reported" && event.wakeRunId) {
        const run = await ctx.db.get(event.wakeRunId)
        if (run && run.status === "queued" && !run.triggerRunId) continue
      }
      await ctx.db.delete(event._id)
    }

    const staleIngress = await ctx.db
      .query("factoryWaitIngressEvents")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "processed").lt("updatedAt", cutoff)
      )
      .take(100)
    for (const ingress of staleIngress) await ctx.db.delete(ingress._id)

    return { expired: due.length, factoryWakeRuns }
  },
})

/** Backstop for wakes lost between recording an event and creating the wake
 * run (a worker crash in that window leaves pending events on an idle
 * thread). The tick redelivers them through workerDeliverPendingWaitWakes.
 * The scan is wide (500 rows) so a page of events parked behind
 * long-running active threads cannot starve idle threads further down. */
export const workerRecoverWaitWakes = query({
  args: {
    now: v.optional(v.number()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"threads">[]> => {
    requireWorkerSecret(args.workerSecret)
    const now = args.now ?? Date.now()

    const stalled = await ctx.db
      .query("factoryWaitEvents")
      .withIndex("by_status_updated", (q) =>
        q
          .eq("status", "pending")
          .lt("updatedAt", now - WAIT_WAKE_RECOVERY_AGE_MS)
      )
      .take(WAKE_RECOVERY_SCAN_LIMIT)

    const threadIds = [...new Set(stalled.map((event) => event.threadId))]
    const deliverable: Id<"threads">[] = []
    for (const threadId of threadIds) {
      if (deliverable.length >= WAKE_RECOVERY_DELIVERY_LIMIT) break
      const active = await activeRunForThread(ctx, threadId)
      if (!active) deliverable.push(threadId)
    }
    return deliverable
  },
})

/** Backstop for the other half of the wake handoff: the wake run exists and
 * its events are already reported, but the factory-dispatch enqueue failed
 * (queueFactoryWakeRuns is fire-and-forget). Reported events whose wake run
 * is still queued with no Trigger run attached identify exactly those
 * stranded wakes; the tick re-enqueues them under the run's idempotency key,
 * so a wake that merely has not been picked up yet is a no-op.
 *
 * The scan covers the event's whole retained life (the GC keeps a reported
 * event alive while its wake is stranded), so a wake stays recoverable until
 * dispatch succeeds no matter how long the outage lasted. Healthy reported
 * events are re-checked each tick until swept; that steady cost buys not
 * needing a dispatch ledger. Under scan saturation an event is examined at
 * latest once it is among the oldest rows before aging out, because rows
 * only leave the window at the old end. */
export const workerRecoverWakeDispatches = query({
  args: {
    now: v.optional(v.number()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args): Promise<FactoryRunCreated[]> => {
    requireWorkerSecret(args.workerSecret)
    const now = args.now ?? Date.now()

    // Both ends of the index: newest-first finds fresh strandings within
    // minutes even when older healthy rows saturate the scan; oldest-first
    // guarantees every row is examined before the GC would reach it.
    const [recent, oldest] = await Promise.all([
      ctx.db
        .query("factoryWaitEvents")
        .withIndex("by_status_updated", (q) =>
          q
            .eq("status", "reported")
            .lt("updatedAt", now - WAIT_WAKE_RECOVERY_AGE_MS)
        )
        .order("desc")
        .take(WAKE_RECOVERY_SCAN_LIMIT),
      ctx.db
        .query("factoryWaitEvents")
        .withIndex("by_status_updated", (q) =>
          q
            .eq("status", "reported")
            .lt("updatedAt", now - WAIT_WAKE_RECOVERY_AGE_MS)
        )
        .take(WAKE_RECOVERY_SCAN_LIMIT),
    ])

    const runIds = [
      ...new Set(
        [...recent, ...oldest]
          .map((event) => event.wakeRunId)
          .filter((runId): runId is Id<"codexRuns"> => Boolean(runId))
      ),
    ]

    const stranded: FactoryRunCreated[] = []
    for (const runId of runIds) {
      const run = await ctx.db.get(runId)
      if (run && run.status === "queued" && !run.triggerRunId) {
        stranded.push({ runId, threadId: run.threadId, userId: run.userId })
      }
    }
    return stranded
  },
})

export const workerDeliverPendingWaitWakes = mutation({
  args: {
    threadIds: v.array(v.id("threads")),
    workerSecret: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ factoryWakeRuns: FactoryRunCreated[] }> => {
    requireWorkerSecret(args.workerSecret)

    const factoryWakeRuns: FactoryRunCreated[] = []
    for (const threadId of args.threadIds.slice(0, 20)) {
      const wake = await maybeCreateFactoryWakeRun(ctx, threadId)
      if (wake) factoryWakeRuns.push(wake)
    }
    return { factoryWakeRuns }
  },
})
