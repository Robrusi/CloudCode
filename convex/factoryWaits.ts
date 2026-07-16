import { v } from "convex/values"

import { api, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import {
  action,
  internalMutation,
  internalQuery,
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
  githubWaitSourceKey,
  linearWaitSourceKey,
  slackWaitEventSourceKey,
  slackWaitSourceKeys,
} from "./lib/factoryWaitTriggers"
import {
  enabledInstallationForUser,
  installationForProviderExternal,
} from "./lib/integrationInstallations"
import { triggerTaskViaApi } from "./lib/triggerApi"
import { getCurrentUser } from "./lib/users"
import { requireWorkerSecret, workerSecretFromEnv } from "./lib/workerAuth"
import { canonicalGitHubRepoUrl } from "@/lib/github/repo"
import { slackThreadParts } from "@/lib/integrations/slack-threads"

/** Reported events are kept this long for webhook dedupe, then swept.
 * Pending events on threads that never free up (user-canceled) share the
 * retention so they cannot accumulate forever. */
const WAIT_EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000

/** Pending events older than this on an idle thread mean the worker that
 * recorded them died before dispatching the wake; the tick redelivers. */
const WAIT_WAKE_RECOVERY_AGE_MS = 5 * 60_000

/** How far back the stranded-dispatch backstop looks at reported events. */
const WAKE_DISPATCH_RECOVERY_WINDOW_MS = 24 * 60 * 60_000

const WAKE_RECOVERY_SCAN_LIMIT = 500
const WAKE_RECOVERY_DELIVERY_LIMIT = 20

const EXPIRE_SWEEP_DEFAULT_LIMIT = 50
const MATCH_SOURCE_KEYS_MAX = 10

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

/** Where an agent-authored Slack message goes: the thread's originating
 * Slack conversation when it has one and no explicit channel was given
 * (the question lands where the humans already are), otherwise the given
 * channel in the user's connected workspace. */
async function resolveSlackPostTarget(
  ctx: QueryCtx | MutationCtx,
  run: Doc<"codexRuns">,
  args: { channelId?: string; threadTs?: string }
): Promise<{
  channelId: string
  installationId: Id<"integrationInstallations">
  slackTeamId: string
  threadTs?: string
}> {
  const explicitChannel = args.channelId?.trim() || undefined
  const explicitThreadTs = args.threadTs?.trim() || undefined

  if (!explicitChannel) {
    const bridge = await ctx.db
      .query("integrationThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", run.threadId))
      .first()
    if (bridge && bridge.provider === "slack") {
      const installation = await ctx.db.get(bridge.installationId)
      if (installation?.enabled) {
        const parts = slackThreadParts(bridge.externalThreadId)
        return {
          channelId: parts.channel,
          installationId: installation._id,
          slackTeamId: installation.externalId,
          threadTs: explicitThreadTs ?? parts.threadTs,
        }
      }
    }
    throw new Error(
      "channelId is required: this thread has no originating Slack conversation to default to."
    )
  }

  const installation = await enabledInstallationForUser(
    ctx,
    run.userId,
    "slack"
  )
  if (!installation) {
    throw new Error("No enabled Slack workspace is connected.")
  }
  return {
    channelId: explicitChannel,
    installationId: installation._id,
    slackTeamId: installation.externalId,
    threadTs: explicitThreadTs,
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
        .collect()
    )
  )
  const waitIds = [...new Set(rowsPerKey.flat().map((row) => row.waitId))]
  const waits = await Promise.all(waitIds.map((waitId) => ctx.db.get(waitId)))

  return waits
    .filter((wait): wait is Doc<"factoryWaits"> =>
      Boolean(wait && wait.status === "armed")
    )
    .map((wait) => ({
      events: wait.events,
      note: wait.note,
      provider: wait.provider,
      threadId: wait.threadId,
      waitId: wait._id,
    }))
}

// ---------------------------------------------------------------------------
// Tool-facing functions (authenticated by the per-run access token).
// ---------------------------------------------------------------------------

export const createWait = mutation({
  args: {
    ...factoryAccessArgs,
    channelId: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    issueId: v.optional(v.string()),
    kind: v.union(
      v.literal("slack_thread"),
      v.literal("github_pr"),
      v.literal("linear_issue")
    ),
    messageTs: v.optional(v.string()),
    note: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    prUrl: v.optional(v.string()),
    threadTs: v.optional(v.string()),
    ttlSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await requireActiveFactoryRunAccess(ctx, args)
    await requireWaitCapacity(ctx, run.threadId, run.userId)
    const now = Date.now()
    const expiresAt = now + clampWaitTtlMs(args.ttlSeconds)
    const note = args.note?.trim() || undefined

    let target: {
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
      const channelId = args.channelId?.trim()
      const messageTs = args.messageTs?.trim()
      const threadTs = args.threadTs?.trim() || undefined
      if (!channelId || !messageTs) {
        throw new Error(
          "channelId and messageTs are required for slack_thread waits."
        )
      }
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
      const prNumber =
        args.prNumber ??
        (args.prUrl ? prNumberFromUrl(args.prUrl, run.repoUrl) : undefined)
      if (!prNumber || !Number.isInteger(prNumber) || prNumber <= 0) {
        throw new Error("prNumber (or prUrl) is required for github_pr waits.")
      }
      target = {
        events: parseWaitEvents(args.events, GITHUB_WAIT_EVENTS),
        prNumber,
        provider: "github",
        repoUrl: run.repoUrl,
        sourceKeys: [githubWaitSourceKey(run.repoUrl, prNumber)],
      }
    } else {
      const issueId = args.issueId?.trim()
      if (!issueId) {
        throw new Error("issueId is required for linear_issue waits.")
      }
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
    }

    const waitId = await ctx.db.insert("factoryWaits", {
      createdAt: now,
      createdByRunId: run._id,
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

    return { events: target.events, expiresAt, status: "armed", waitId }
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

export const workerCreateArmingWait = internalMutation({
  args: {
    ...factoryAccessArgs,
    channelId: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    note: v.optional(v.string()),
    threadTs: v.optional(v.string()),
    ttlSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await requireActiveFactoryRunAccess(ctx, args)
    await requireWaitCapacity(ctx, run.threadId, run.userId)
    const events = parseWaitEvents(args.events, SLACK_WAIT_EVENTS)
    const now = Date.now()
    const expiresAt = now + clampWaitTtlMs(args.ttlSeconds)
    const note = args.note?.trim() || undefined
    const target = await resolveSlackPostTarget(ctx, run, {
      channelId: args.channelId,
      threadTs: args.threadTs,
    })

    const waitId = await ctx.db.insert("factoryWaits", {
      createdAt: now,
      createdByRunId: run._id,
      events,
      expiresAt,
      installationId: target.installationId,
      messageChannelId: target.channelId,
      ...(target.threadTs ? { messageThreadTs: target.threadTs } : {}),
      ...(note ? { note } : {}),
      provider: "slack",
      sourceKeys: [],
      status: "arming",
      threadId: run.threadId,
      updatedAt: now,
      userId: run.userId,
    })

    return {
      channelId: target.channelId,
      expiresAt,
      slackTeamId: target.slackTeamId,
      threadTs: target.threadTs,
      userId: run.userId,
      waitId,
    }
  },
})

export const workerResolveSlackPost = internalQuery({
  args: {
    ...factoryAccessArgs,
    channelId: v.optional(v.string()),
    threadTs: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await requireActiveFactoryRunAccess(ctx, args)
    const target = await resolveSlackPostTarget(ctx, run, {
      channelId: args.channelId,
      threadTs: args.threadTs,
    })
    return {
      channelId: target.channelId,
      slackTeamId: target.slackTeamId,
      threadTs: target.threadTs,
      userId: run.userId,
    }
  },
})

/** ask_human: posts a question to Slack and registers a wait on replies and
 * reactions in one call. The post happens in the factory-wait-arm Trigger
 * task (provider SDKs live in Node workers, not Convex); until it confirms,
 * the wait is "arming". A post that ultimately fails wakes the agent so the
 * question is never silently lost. */
export const askHuman = action({
  args: {
    ...factoryAccessArgs,
    channelId: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    message: v.string(),
    note: v.optional(v.string()),
    threadTs: v.optional(v.string()),
    ttlSeconds: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    channelId: string
    expiresAt: number
    status: string
    waitId: string
  }> => {
    const message = args.message.trim()
    if (!message) throw new Error("message is required.")

    const created = await ctx.runMutation(
      internal.factoryWaits.workerCreateArmingWait,
      {
        accessToken: args.accessToken,
        channelId: args.channelId,
        events: args.events,
        note: args.note,
        runId: args.runId,
        threadId: args.threadId,
        threadTs: args.threadTs,
        ttlSeconds: args.ttlSeconds,
      }
    )

    try {
      await triggerTaskViaApi({
        idempotencyKey: `factory-wait-arm:${created.waitId}`,
        payload: {
          channelId: created.channelId,
          markdown: message,
          slackTeamId: created.slackTeamId,
          threadTs: created.threadTs,
          waitId: created.waitId,
        },
        tags: [`user:${created.userId}`, `thread:${args.threadId}`],
        taskId: "factory-wait-arm",
      })
    } catch (error) {
      // The agent is still running and sees this error directly, so fail the
      // wait without the wake-notification a background arm failure needs.
      const errorMessage =
        error instanceof Error ? error.message : "Unable to queue the post."
      await ctx
        .runMutation(api.factoryWaits.workerFailWaitArm, {
          error: errorMessage,
          notify: false,
          waitId: created.waitId,
          workerSecret: workerSecretFromEnv(),
        })
        .catch(() => undefined)
      throw new Error(errorMessage)
    }

    return {
      channelId: created.channelId,
      expiresAt: created.expiresAt,
      status: "arming",
      waitId: created.waitId,
    }
  },
})

/** Post-only variant of ask_human: sends a Slack message without waiting on
 * anything. Delivery is best-effort, matching run-finished notifications. */
export const slackPostMessage = action({
  args: {
    ...factoryAccessArgs,
    channelId: v.optional(v.string()),
    message: v.string(),
    threadTs: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ channelId: string; queued: boolean }> => {
    const message = args.message.trim()
    if (!message) throw new Error("message is required.")

    const target = await ctx.runQuery(
      internal.factoryWaits.workerResolveSlackPost,
      {
        accessToken: args.accessToken,
        channelId: args.channelId,
        runId: args.runId,
        threadId: args.threadId,
        threadTs: args.threadTs,
      }
    )

    await triggerTaskViaApi({
      idempotencyKey: `factory-slack-post:${crypto.randomUUID()}`,
      payload: {
        channelId: target.channelId,
        markdown: message,
        slackTeamId: target.slackTeamId,
        threadTs: target.threadTs,
      },
      tags: [`user:${target.userId}`, `thread:${args.threadId}`],
      taskId: "factory-wait-arm",
    })

    return { channelId: target.channelId, queued: true }
  },
})

// ---------------------------------------------------------------------------
// UI query.
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

// ---------------------------------------------------------------------------
// Worker functions (Trigger tasks and webhook routes).
// ---------------------------------------------------------------------------

export const workerArmWait = mutation({
  args: {
    channelId: v.string(),
    messageTs: v.string(),
    threadTs: v.optional(v.string()),
    waitId: v.id("factoryWaits"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const wait = await ctx.db.get(args.waitId)
    if (!wait || wait.status !== "arming" || !wait.installationId) {
      return { armed: false }
    }
    // A post delayed past the wait's own deadline must not arm a listener
    // that would accept post-TTL events; the sweep expires the wait and
    // wakes the agent with the timeout notice instead.
    if (Date.now() > wait.expiresAt) {
      return { armed: false }
    }

    const sourceKeys = slackWaitSourceKeys({
      channelId: args.channelId,
      installationId: wait.installationId,
      messageTs: args.messageTs,
      threadTs: args.threadTs,
    })
    await ctx.db.patch(wait._id, {
      messageChannelId: args.channelId,
      ...(args.threadTs ? { messageThreadTs: args.threadTs } : {}),
      messageTs: args.messageTs,
      sourceKeys,
      status: "armed",
      updatedAt: Date.now(),
    })
    await insertWaitKeys(ctx, wait, sourceKeys)

    return { armed: true }
  },
})

export const workerFailWaitArm = mutation({
  args: {
    error: v.string(),
    notify: v.boolean(),
    waitId: v.id("factoryWaits"),
    workerSecret: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ factoryWakeRuns: FactoryRunCreated[] }> => {
    requireWorkerSecret(args.workerSecret)

    const wait = await ctx.db.get(args.waitId)
    if (!wait || wait.status !== "arming") return { factoryWakeRuns: [] }

    await closeWait(ctx, wait, "failed", args.error)
    if (!args.notify) return { factoryWakeRuns: [] }

    await insertWaitEvent(ctx, wait, {
      eventKey: `arm_failed:${wait._id}`,
      eventVars: {
        event: "arm_failed",
        summary: `ask_human failed: ${args.error} The wait is closed — retry ask_human or continue without the answer.`,
      },
    })
    const wake = await maybeCreateFactoryWakeRun(ctx, wait.threadId)
    return { factoryWakeRuns: wake ? [wake] : [] }
  },
})

/** Generic pre-ack matcher: which armed waits listen on any of these source
 * keys? Ordinary webhook traffic costs one indexed lookup per key and
 * nothing more. */
export const workerMatchWaitEvents = query({
  args: {
    sourceKeys: v.array(v.string()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    return await matchWaitsBySourceKeys(ctx, args.sourceKeys)
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
      linearWaitSourceKey(installation._id, args.issueId),
    ])
    return matches.filter((match) => match.events.includes("comment"))
  },
})

export const workerRecordWaitEvent = mutation({
  args: {
    eventKey: v.string(),
    eventName: v.string(),
    eventVars: v.record(v.string(), v.string()),
    externalThreadId: v.optional(v.string()),
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

    const wait = await ctx.db.get(args.waitId)
    if (!wait) return { factoryWakeRuns: [], queued: false, reason: "gone" }

    // A Slack reply on this thread's own bridged conversation is already
    // delivered as a follow-up run by the integration pipeline; queueing it
    // here would run the thread twice for one message. The wait still counts
    // as answered.
    if (
      wait.provider === "slack" &&
      args.eventName === "reply" &&
      args.externalThreadId &&
      wait.status === "armed"
    ) {
      const bridge = await ctx.db
        .query("integrationThreads")
        .withIndex("by_thread", (q) => q.eq("threadId", wait.threadId))
        .first()
      if (
        bridge &&
        bridge.provider === "slack" &&
        bridge.externalThreadId === args.externalThreadId
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
        return {
          factoryWakeRuns: [],
          queued: false,
          reason: "bridged_follow_up",
        }
      }
    }

    const result = await recordWaitEvent(ctx, wait, {
      eventKey: args.eventKey,
      eventName: args.eventName,
      eventVars: args.eventVars,
    })
    if (!result.queued) {
      return { factoryWakeRuns: [], queued: false, reason: result.reason }
    }

    const wake = await maybeCreateFactoryWakeRun(ctx, wait.threadId)
    return { factoryWakeRuns: wake ? [wake] : [], queued: true }
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

    const factoryWakeRuns: FactoryRunCreated[] = []
    for (const threadId of threadIds) {
      const wake = await maybeCreateFactoryWakeRun(ctx, threadId)
      if (wake) factoryWakeRuns.push(wake)
    }

    // Reported events past retention, plus pending events stuck on threads
    // that never free up (e.g. user-canceled), are swept together.
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
    await Promise.all(
      staleByStatus.flat().map((event) => ctx.db.delete(event._id))
    )

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
 * so a wake that merely has not been picked up yet is a no-op. */
export const workerRecoverWakeDispatches = query({
  args: {
    now: v.optional(v.number()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args): Promise<FactoryRunCreated[]> => {
    requireWorkerSecret(args.workerSecret)
    const now = args.now ?? Date.now()

    // Healthy reported events stay in this window for a day and are
    // re-checked each tick; that steady cost buys not needing a dispatch
    // ledger. A wake stranded longer than the window means the tick itself
    // was down that long.
    const reported = await ctx.db
      .query("factoryWaitEvents")
      .withIndex("by_status_updated", (q) =>
        q
          .eq("status", "reported")
          .gt("updatedAt", now - WAKE_DISPATCH_RECOVERY_WINDOW_MS)
          .lt("updatedAt", now - WAIT_WAKE_RECOVERY_AGE_MS)
      )
      .take(WAKE_RECOVERY_SCAN_LIMIT)

    const runIds = [
      ...new Set(
        reported
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
