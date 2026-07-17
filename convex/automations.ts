import { v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx } from "./_generated/server"
import {
  disableAutomation,
  recordAutomationFailure,
} from "./lib/automationRecords"
import {
  ACTIVE_RUN_STATUS_VALUES,
  activeRunForThread,
} from "./lib/codexRunLifecycle"
import { findCodexAuth } from "./lib/codexRunAuth"
import {
  appendCodexRunLogs,
  upsertCodexRunCheckpoint,
} from "./lib/codexRunRecords"
import {
  automationSandboxRetention,
  automationThreadMode,
  branchMode,
  model,
  speed,
  thinking,
} from "./lib/codexRunValidators"
import {
  automationTrigger,
  automationTriggerOf,
  automationTriggerSourceKey,
  type AutomationTrigger,
} from "./lib/integrationTriggers"
import { resolveOwnedPresetOrAutoDefault } from "./lib/sandboxPresets"
import { throwUserError } from "./lib/userErrors"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"
import {
  codexAuthMissingMessage,
  codexAuthReconnectMessage,
} from "@/lib/codex/auth-errors"
import { LINEAR_COMMENT_AUTHOR_FILTER_MAX } from "@/lib/automations/linear-comment-trigger"
import {
  modelSupportsThinking,
  modelThinkingCompatibilityError,
} from "@/lib/chat/options"

// Guard against a stale client clock or a stale form submitting a nextRunAt
// that is already far in the past, which would fire immediately.
const NEXT_RUN_AT_PAST_TOLERANCE_MS = 5 * 60_000
const EVENT_QUEUE_MAX_PENDING = 100
const EVENT_DISPATCH_LEASE_MS = 5 * 60_000
const EVENT_RECOVERY_LIMIT = 100
const EVENT_DEDUPE_RETENTION_MS = 30 * 24 * 60 * 60_000
const automationConfigArgs = {
  autoEnvironment: v.optional(v.boolean()),
  baseBranch: v.optional(v.string()),
  branchMode: v.optional(branchMode),
  branchName: v.optional(v.string()),
  cron: v.optional(v.string()),
  model,
  name: v.string(),
  profile: v.optional(v.string()),
  prompt: v.string(),
  reasoningEffort: thinking,
  repoUrl: v.string(),
  sandboxPresetId: v.optional(v.id("sandboxPresets")),
  sandboxRetention: v.optional(automationSandboxRetention),
  speed,
  threadMode: v.optional(automationThreadMode),
  timezone: v.optional(v.string()),
  trigger: v.optional(automationTrigger),
}

type AutomationConfigArgs = {
  autoEnvironment?: boolean
  baseBranch?: string
  branchMode?: Doc<"automations">["branchMode"]
  branchName?: string
  cron?: string
  model: Doc<"automations">["model"]
  name: string
  profile?: string
  prompt: string
  reasoningEffort: Doc<"automations">["reasoningEffort"]
  repoUrl: string
  sandboxPresetId?: Id<"sandboxPresets">
  sandboxRetention?: Doc<"automations">["sandboxRetention"]
  speed: Doc<"automations">["speed"]
  threadMode?: Doc<"automations">["threadMode"]
  timezone?: string
  trigger?: AutomationTrigger
}

/** Resolves the canonical trigger from the request: an explicit trigger
 * object, or the legacy cron/timezone pair from clients that predate event
 * triggers. Validates the fields the trigger kind requires. */
async function resolveAutomationTrigger(
  ctx: MutationCtx,
  args: AutomationConfigArgs,
  userId: Id<"users">
): Promise<AutomationTrigger> {
  const trigger: AutomationTrigger = args.trigger ?? {
    cron: args.cron ?? "",
    kind: "cron",
    timezone: args.timezone ?? "",
  }

  if (trigger.kind === "cron") {
    if (!trigger.cron.trim()) throwUserError("cron is required.")
    if (!trigger.timezone.trim()) throwUserError("timezone is required.")
    return {
      cron: trigger.cron.trim(),
      kind: "cron",
      timezone: trigger.timezone.trim(),
    }
  }

  if (trigger.kind === "github") {
    if (!trigger.installationId?.trim()) {
      throwUserError(
        "Install the GitHub App on this repository before enabling its trigger."
      )
    }
    const installation = await ctx.db
      .query("githubAppInstallations")
      .withIndex("by_user_installation", (q) =>
        q
          .eq("userId", userId)
          .eq("installationId", trigger.installationId!.trim())
      )
      .unique()
    if (!installation) {
      throwUserError(
        "The GitHub App installation for this trigger is no longer connected."
      )
    }
    return {
      ...trigger,
      actorLogin:
        trigger.actorLogin?.trim().replace(/^@/, "").toLowerCase() || undefined,
      branch: trigger.branch?.trim().replace(/^refs\/heads\//, "") || undefined,
      installationId: installation.installationId,
    }
  }

  const installation = await ctx.db.get(trigger.installationId)
  if (
    !installation ||
    installation.userId !== userId ||
    installation.provider !== trigger.kind
  ) {
    throwUserError("Connect the integration before using it as a trigger.")
  }

  if (trigger.kind === "slack") {
    if (trigger.event === "keyword" && !trigger.keyword?.trim()) {
      throwUserError("keyword is required for keyword triggers.")
    }
    if (trigger.event === "reaction" && !trigger.emoji?.trim()) {
      throwUserError("emoji is required for reaction triggers.")
    }
    return {
      ...trigger,
      emoji: trigger.emoji?.trim().replace(/^:|:$/g, "") || undefined,
      keyword: trigger.keyword?.trim() || undefined,
    }
  }

  if (trigger.event === "labelAdded" && !trigger.labelId?.trim()) {
    throwUserError("labelId is required for label triggers.")
  }
  if (trigger.event === "issueAssigned" && !trigger.assigneeId?.trim()) {
    throwUserError("assigneeId is required for assignment triggers.")
  }
  if (trigger.event === "commentCreated") {
    const commentAuthorMode = trigger.commentAuthorMode ?? "any"
    const commentAuthorIds = [
      ...new Set(
        (trigger.commentAuthorIds ?? []).map((id) => id.trim()).filter(Boolean)
      ),
    ]
    if (commentAuthorIds.length > LINEAR_COMMENT_AUTHOR_FILTER_MAX) {
      throwUserError(
        `Choose at most ${LINEAR_COMMENT_AUTHOR_FILTER_MAX} comment authors.`
      )
    }
    if (commentAuthorMode !== "any" && commentAuthorIds.length === 0) {
      throwUserError("Choose at least one comment author.")
    }
    const nameById = new Map(
      (trigger.commentAuthorIds ?? []).map((id, index) => [
        id.trim(),
        trigger.commentAuthorNames?.[index]?.trim(),
      ])
    )
    return {
      ...trigger,
      assigneeId: undefined,
      assigneeName: undefined,
      commentAuthorIds:
        commentAuthorMode === "any" ? undefined : commentAuthorIds,
      commentAuthorMode,
      commentAuthorNames:
        commentAuthorMode === "any"
          ? undefined
          : commentAuthorIds.map((id) => nameById.get(id) || id),
      labelId: undefined,
      labelName: undefined,
      stateId: undefined,
      stateName: undefined,
      teamId: undefined,
      teamName: undefined,
    }
  }
  return {
    ...trigger,
    commentAuthorIds: undefined,
    commentAuthorMode: undefined,
    commentAuthorNames: undefined,
  }
}

/** Denormalized trigger columns stored alongside the trigger object: the
 * legacy cron/timezone pair for cron kind, and the source key that
 * by_trigger_source matches webhook events against for event kinds. */
function triggerColumns(trigger: AutomationTrigger, repoUrl: string) {
  return {
    cron: trigger.kind === "cron" ? trigger.cron : undefined,
    timezone: trigger.kind === "cron" ? trigger.timezone : undefined,
    trigger,
    triggerKind: trigger.kind,
    triggerSourceKey: automationTriggerSourceKey(trigger, repoUrl),
  }
}

function validateAutomationConfig(args: AutomationConfigArgs) {
  if (!args.name.trim()) throwUserError("name is required.")
  if (!args.prompt.trim()) throwUserError("prompt is required.")
  if (!args.repoUrl.trim()) throwUserError("repoUrl is required.")
  if (!modelSupportsThinking(args.model, args.reasoningEffort)) {
    throwUserError(
      modelThinkingCompatibilityError(args.model, args.reasoningEffort)
    )
  }
}

function validateNextRunAt(nextRunAt: number) {
  if (nextRunAt < Date.now() - NEXT_RUN_AT_PAST_TOLERANCE_MS) {
    throwUserError("nextRunAt is in the past.")
  }
}

async function requireOwnedAutomation(
  ctx: MutationCtx,
  automationId: Id<"automations">,
  userId: Id<"users">
) {
  const automation = await ctx.db.get(automationId)
  if (!automation || automation.userId !== userId) {
    throwUserError("Automation not found.")
  }

  return automation
}

async function deleteQueuedAutomationEvents(
  ctx: MutationCtx,
  automationId: Id<"automations">,
  options: { includeInFlight?: boolean } = {}
) {
  const queued = await ctx.db
    .query("automationEventQueue")
    .withIndex("by_automation_created", (q) =>
      q.eq("automationId", automationId)
    )
    .collect()
  await Promise.all(
    queued
      .filter(
        (event) =>
          options.includeInFlight ||
          event.status === "pending" ||
          event.status === "dispatching"
      )
      .map((event) => ctx.db.delete(event._id))
  )
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []

    const automations = await ctx.db
      .query("automations")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect()

    return automations
  },
})

export const create = mutation({
  args: {
    ...automationConfigArgs,
    nextRunAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    validateAutomationConfig(args)
    const trigger = await resolveAutomationTrigger(ctx, args, userId)
    const nextRunAt = trigger.kind === "cron" ? args.nextRunAt : undefined
    if (trigger.kind === "cron") {
      if (nextRunAt === undefined) {
        throwUserError("nextRunAt is required for scheduled automations.")
      }
      validateNextRunAt(nextRunAt)
    }
    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      args.sandboxPresetId,
      userId,
      { autoEnvironment: args.autoEnvironment }
    )

    const now = Date.now()
    const trimmedBaseBranch = args.baseBranch?.trim()
    const threadId = await ctx.db.insert("threads", {
      ...(trimmedBaseBranch ? { baseBranch: trimmedBaseBranch } : {}),
      ...(args.branchMode ? { branchMode: args.branchMode } : {}),
      createdAt: now,
      model: args.model,
      repoUrl: args.repoUrl,
      sandboxPresetId,
      title: args.name.trim(),
      updatedAt: now,
      userId,
    })

    const automationId = await ctx.db.insert("automations", {
      autoEnvironment: args.autoEnvironment,
      ...(trimmedBaseBranch ? { baseBranch: trimmedBaseBranch } : {}),
      ...(args.branchMode ? { branchMode: args.branchMode } : {}),
      ...(args.branchName?.trim()
        ? { branchName: args.branchName.trim() }
        : {}),
      createdAt: now,
      enabled: true,
      failureCount: 0,
      model: args.model,
      name: args.name.trim(),
      nextRunAt,
      ...(args.profile ? { profile: args.profile } : {}),
      prompt: args.prompt.trim(),
      reasoningEffort: args.reasoningEffort,
      repoUrl: args.repoUrl,
      sandboxPresetId,
      ...(args.sandboxRetention
        ? { sandboxRetention: args.sandboxRetention }
        : {}),
      speed: args.speed,
      threadId,
      ...(args.threadMode ? { threadMode: args.threadMode } : {}),
      ...triggerColumns(trigger, args.repoUrl),
      updatedAt: now,
      userId,
    })

    // Link the thread back to its automation so the chat list can hide it
    // until the first run gives it real content.
    await ctx.db.patch(threadId, { automationId })

    return { automationId, threadId }
  },
})

export const update = mutation({
  args: {
    ...automationConfigArgs,
    automationId: v.id("automations"),
    nextRunAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    validateAutomationConfig(args)
    const trigger = await resolveAutomationTrigger(ctx, args, userId)
    const automation = await requireOwnedAutomation(
      ctx,
      args.automationId,
      userId
    )
    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      args.sandboxPresetId,
      userId,
      { autoEnvironment: args.autoEnvironment }
    )

    const now = Date.now()
    const trimmedBaseBranch = args.baseBranch?.trim()
    const nextRunAt = trigger.kind === "cron" ? args.nextRunAt : undefined
    if (automation.enabled && trigger.kind === "cron") {
      if (nextRunAt === undefined) {
        throwUserError("nextRunAt is required for scheduled automations.")
      }
      validateNextRunAt(nextRunAt)
    }

    await Promise.all([
      ctx.db.patch(automation._id, {
        autoEnvironment: args.autoEnvironment,
        baseBranch: trimmedBaseBranch || undefined,
        branchMode: args.branchMode,
        branchName: args.branchName?.trim() || undefined,
        model: args.model,
        name: args.name.trim(),
        // Event triggers never schedule; switching kinds clears the slot.
        nextRunAt: automation.enabled ? nextRunAt : undefined,
        profile: args.profile,
        prompt: args.prompt.trim(),
        reasoningEffort: args.reasoningEffort,
        repoUrl: args.repoUrl,
        sandboxPresetId,
        sandboxRetention: args.sandboxRetention,
        speed: args.speed,
        threadMode: args.threadMode,
        ...triggerColumns(trigger, args.repoUrl),
        updatedAt: now,
      }),
      // The automation's thread mirrors its config so the chat UI shows the
      // right repo/model when browsing run history.
      ctx.db.patch(automation.threadId, {
        baseBranch: trimmedBaseBranch || undefined,
        branchMode: args.branchMode,
        model: args.model,
        repoUrl: args.repoUrl,
        sandboxPresetId,
        title: args.name.trim(),
        updatedAt: now,
      }),
    ])

    return { automationId: automation._id }
  },
})

export const setEnabled = mutation({
  args: {
    automationId: v.id("automations"),
    enabled: v.boolean(),
    nextRunAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const automation = await requireOwnedAutomation(
      ctx,
      args.automationId,
      userId
    )

    if (args.enabled) {
      const isCron = automationTriggerOf(automation).kind === "cron"
      if (isCron && args.nextRunAt === undefined) {
        throwUserError("nextRunAt is required when enabling an automation.")
      }
      if (isCron && args.nextRunAt !== undefined) {
        validateNextRunAt(args.nextRunAt)
      }
      await ctx.db.patch(automation._id, {
        disabledReason: undefined,
        enabled: true,
        eventFireCount: undefined,
        eventFireWindowStart: undefined,
        failureCount: 0,
        nextRunAt: isCron ? args.nextRunAt : undefined,
        updatedAt: Date.now(),
      })
      return
    }

    await ctx.db.patch(automation._id, {
      disabledReason: undefined,
      enabled: false,
      nextRunAt: undefined,
      updatedAt: Date.now(),
    })
    await deleteQueuedAutomationEvents(ctx, automation._id)
  },
})

export const remove = mutation({
  args: {
    automationId: v.id("automations"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const automation = await requireOwnedAutomation(
      ctx,
      args.automationId,
      userId
    )

    // A thread with run history survives as a normal chat; one that never ran
    // is an empty shell hidden from the chat list, so drop it too.
    const thread = await ctx.db.get(automation.threadId)
    if (thread && !thread.lastUserMessageAt) {
      await ctx.db.delete(automation.threadId)
    } else if (thread?.automationId === automation._id) {
      await ctx.db.patch(automation.threadId, { automationId: undefined })
    }
    await deleteQueuedAutomationEvents(ctx, automation._id, {
      includeInFlight: true,
    })
    await ctx.db.delete(automation._id)
  },
})

export const get = query({
  args: {
    automationId: v.id("automations"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.userId !== user._id) return null

    return automation
  },
})

const RECENT_RUNS_MAX_LIMIT = 100

/** Latest runs of one automation, for the expandable row on the screen.
 * Fetches one row past `limit` so the client knows whether to offer more. */
export const recentRuns = query({
  args: {
    automationId: v.id("automations"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return { hasMore: false, runs: [] }

    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.userId !== user._id) {
      return { hasMore: false, runs: [] }
    }

    const limit = Math.min(
      Math.max(Math.floor(args.limit), 1),
      RECENT_RUNS_MAX_LIMIT
    )
    const runs = await ctx.db
      .query("codexRuns")
      .withIndex("by_automation_created", (q) =>
        q.eq("automationId", args.automationId)
      )
      .order("desc")
      .take(limit + 1)

    return {
      hasMore: runs.length > limit,
      runs: runs.slice(0, limit).map((run) => ({
        createdAt: run.createdAt,
        error: run.error,
        finishedAt: run.finishedAt,
        id: run._id,
        startedAt: run.startedAt,
        status: run.status,
        threadId: run.threadId,
      })),
    }
  },
})

/** "active" folds the in-flight statuses (queued/running/canceling) into one
 * user-facing filter. */
const runsFeedStatusFilter = v.union(
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("active"),
  v.literal("canceled")
)

/** Latest runs across all of the user's automations, newest first, for the
 * Runs view on the automations screen. Merges per-automation index pages
 * (by_automation_created, or by_automation_status_created when filtered), so
 * cost is bounded by the automation count instead of scanning codexRuns. */
export const runsFeed = query({
  args: {
    limit: v.number(),
    status: v.optional(runsFeedStatusFilter),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return { hasMore: false, runs: [] }

    const limit = Math.min(
      Math.max(Math.floor(args.limit), 1),
      RECENT_RUNS_MAX_LIMIT
    )
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .collect()

    const statuses =
      args.status === "active"
        ? ACTIVE_RUN_STATUS_VALUES
        : args.status
          ? [args.status]
          : null
    const pages = await Promise.all(
      automations.map((automation) => {
        if (!statuses) {
          return ctx.db
            .query("codexRuns")
            .withIndex("by_automation_created", (q) =>
              q.eq("automationId", automation._id)
            )
            .order("desc")
            .take(limit + 1)
        }
        return Promise.all(
          statuses.map((status) =>
            ctx.db
              .query("codexRuns")
              .withIndex("by_automation_status_created", (q) =>
                q.eq("automationId", automation._id).eq("status", status)
              )
              .order("desc")
              .take(limit + 1)
          )
        ).then((byStatus) => byStatus.flat())
      })
    )

    const merged = automations.flatMap((automation, index) =>
      pages[index].map((run) => ({
        automationId: automation._id,
        automationName: automation.name,
        createdAt: run.createdAt,
        error: run.error,
        finishedAt: run.finishedAt,
        id: run._id,
        startedAt: run.startedAt,
        status: run.status,
        threadId: run.threadId,
      }))
    )
    merged.sort((a, b) => b.createdAt - a.createdAt)

    return {
      hasMore: merged.length > limit,
      runs: merged.slice(0, limit),
    }
  },
})

export const dueForWorker = query({
  args: {
    limit: v.number(),
    now: v.number(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const due = await ctx.db
      .query("automations")
      .withIndex("by_enabled_next", (q) =>
        q.eq("enabled", true).gt("nextRunAt", 0).lte("nextRunAt", args.now)
      )
      .take(Math.min(Math.max(args.limit, 1), 100))

    // Only cron automations carry a nextRunAt, so every row here reads as
    // the cron kind (legacy rows through automationTriggerOf).
    return due.map((automation) => {
      const trigger = automationTriggerOf(automation)
      return {
        _id: automation._id,
        cron: trigger.kind === "cron" ? trigger.cron : "",
        nextRunAt: automation.nextRunAt!,
        timezone: trigger.kind === "cron" ? trigger.timezone : "UTC",
        userId: automation.userId,
      }
    })
  },
})

// Compare-and-set claim on nextRunAt: of N concurrent ticks that read the
// same due automation, exactly one observes the expected value and advances
// it, so exactly one dispatches the run.
export const claimForWorker = mutation({
  args: {
    automationId: v.id("automations"),
    expectedNextRunAt: v.number(),
    nextRunAt: v.number(),
    now: v.number(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const automation = await ctx.db.get(args.automationId)
    if (
      !automation ||
      !automation.enabled ||
      automation.nextRunAt !== args.expectedNextRunAt ||
      args.nextRunAt <= args.now
    ) {
      return { claimed: false as const }
    }

    await ctx.db.patch(automation._id, {
      nextRunAt: args.nextRunAt,
      updatedAt: Date.now(),
    })

    return {
      claimed: true as const,
      scheduledFor: args.expectedNextRunAt,
      userId: automation.userId,
    }
  },
})

/** Restores a cron slot when Trigger.dev rejected the child enqueue. The CAS
 * keeps a later scheduler claim from being moved backwards. */
export const releaseScheduleClaimForWorker = mutation({
  args: {
    automationId: v.id("automations"),
    expectedNextRunAt: v.number(),
    scheduledFor: v.number(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const automation = await ctx.db.get(args.automationId)
    if (
      !automation ||
      !automation.enabled ||
      automation.nextRunAt !== args.expectedNextRunAt
    ) {
      return { released: false as const }
    }
    await ctx.db.patch(automation._id, {
      nextRunAt: args.scheduledFor,
      updatedAt: Date.now(),
    })
    return { released: true as const }
  },
})

export const getForWorker = query({
  args: {
    automationId: v.id("automations"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const automation = await ctx.db.get(args.automationId)
    if (!automation) return null

    const activeRun = await activeRunForThread(ctx, automation.threadId)

    return { activeRun: Boolean(activeRun), automation }
  },
})

export const workerCreateRun = mutation({
  args: {
    automationId: v.id("automations"),
    eventQueueId: v.optional(v.id("automationEventQueue")),
    githubToken: v.optional(v.string()),
    githubUserEmail: v.optional(v.string()),
    githubUserName: v.optional(v.string()),
    githubUsername: v.optional(v.string()),
    manual: v.boolean(),
    notesAccessToken: v.string(),
    // Event-triggered fires interpolate the triggering event into the
    // configured prompt; when set this full text replaces automation.prompt.
    prompt: v.optional(v.string()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const automation = await ctx.db.get(args.automationId)
    if (!automation) {
      return { ok: false as const, status: "not_found" as const }
    }
    if (!automation.enabled && !args.manual) {
      return { ok: false as const, status: "disabled" as const }
    }
    const queuedEvent = args.eventQueueId
      ? await ctx.db.get(args.eventQueueId)
      : null
    if (
      args.eventQueueId &&
      (!queuedEvent || queuedEvent.automationId !== automation._id)
    ) {
      return { ok: false as const, status: "not_found" as const }
    }
    if (queuedEvent?.runId) {
      const existingRun = await ctx.db.get(queuedEvent.runId)
      if (existingRun?.automationId === automation._id) {
        return {
          ok: true as const,
          runId: existingRun._id,
          threadId: existingRun.threadId,
          userId: existingRun.userId,
        }
      }
    }
    const thread = await ctx.db.get(automation.threadId)
    if (!thread) {
      return { ok: false as const, status: "not_found" as const }
    }
    if (thread.hasPendingMessage) {
      const activeRun = await activeRunForThread(ctx, automation.threadId)
      if (activeRun) {
        return { ok: false as const, status: "thread_busy" as const }
      }
    }

    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      automation.sandboxPresetId ?? thread.sandboxPresetId,
      automation.userId,
      { autoEnvironment: automation.autoEnvironment }
    )
    const { auth, profile: authProfile } = await findCodexAuth(
      ctx,
      automation.userId,
      automation.profile,
      { fallbackToActive: true }
    )
    if (!auth) {
      return {
        ok: false as const,
        message: codexAuthMissingMessage(authProfile),
        status: "missing_auth" as const,
      }
    }
    if (auth.invalidatedAt) {
      return {
        ok: false as const,
        message: codexAuthReconnectMessage(authProfile),
        status: "auth_reconnect_required" as const,
      }
    }

    const now = Date.now()
    const userId = automation.userId
    const sandboxRetention = automation.sandboxRetention ?? "delete"
    const threadMode = automation.threadMode ?? "single"

    // Per-run mode opens a fresh chat once the current one has been used;
    // automation.threadId always points at the latest chat so "Open chat"
    // and the overlap guard track it.
    let threadId = automation.threadId
    if (threadMode === "per-run" && thread.lastUserMessageAt) {
      threadId = await ctx.db.insert("threads", {
        automationId: automation._id,
        ...(automation.baseBranch ? { baseBranch: automation.baseBranch } : {}),
        ...(automation.branchMode ? { branchMode: automation.branchMode } : {}),
        createdAt: now,
        model: automation.model,
        repoUrl: automation.repoUrl,
        sandboxPresetId,
        title: automation.name,
        updatedAt: now,
        userId,
      })
    }

    // "Idle" retention keeps the sandbox on the chat at run end; when the
    // same chat runs again it resumes that sandbox instead of provisioning
    // a fresh one.
    const reusedSandboxId =
      sandboxRetention === "idle" &&
      threadId === automation.threadId &&
      thread.sandboxState !== "deleted"
        ? thread.sandboxId
        : undefined

    const prompt = args.prompt?.trim() || automation.prompt
    await ctx.db.insert("messages", {
      content: prompt,
      role: "user",
      threadId,
      userId,
    })
    const assistantMessageId = await ctx.db.insert("messages", {
      content: "",
      pending: true,
      role: "assistant",
      speed: automation.speed,
      thinking: automation.reasoningEffort,
      threadId,
      userId,
    })

    const queuedLog = {
      kind: "setup" as const,
      message: "Queued Codex run",
      time: now,
    }
    const runId = await ctx.db.insert("codexRuns", {
      assistantMessageId,
      automationId: automation._id,
      ...(automation.baseBranch ? { baseBranch: automation.baseBranch } : {}),
      ...(automation.branchMode ? { branchMode: automation.branchMode } : {}),
      ...(automation.branchName ? { branchName: automation.branchName } : {}),
      createdAt: now,
      ephemeralSandbox: sandboxRetention === "delete",
      model: automation.model,
      profile: auth.profile,
      reasoningEffort: automation.reasoningEffort,
      repoUrl: automation.repoUrl,
      sandboxPresetId,
      ...(reusedSandboxId
        ? { sandboxId: reusedSandboxId, sandboxState: "running" as const }
        : {}),
      speed: automation.speed,
      status: "queued",
      threadId,
      updatedAt: now,
      userId,
      ...(args.githubUserEmail
        ? { githubUserEmail: args.githubUserEmail }
        : {}),
      ...(args.githubUserName ? { githubUserName: args.githubUserName } : {}),
      ...(args.githubUsername ? { githubUsername: args.githubUsername } : {}),
    })

    await Promise.all([
      ctx.db.insert("codexRunInputs", {
        ...(args.githubToken ? { githubToken: args.githubToken } : {}),
        notesAccessToken: args.notesAccessToken,
        prompt,
        runId,
        userId,
      }),
      upsertCodexRunCheckpoint(
        ctx,
        { _id: runId, threadId, userId },
        { content: "" }
      ),
      appendCodexRunLogs(ctx, { _id: runId, threadId, userId }, [queuedLog]),
      ctx.db.patch(threadId, {
        hasPendingMessage: true,
        lastUserMessageAt: now,
        updatedAt: now,
      }),
      ctx.db.patch(automation._id, {
        lastRunAt: now,
        lastRunError: undefined,
        lastRunStatus: "running",
        ...(threadId !== automation.threadId ? { threadId } : {}),
        updatedAt: now,
      }),
      queuedEvent
        ? ctx.db.patch(queuedEvent._id, {
            dispatchLeaseExpiresAt: undefined,
            runId,
            status: "run_created",
            updatedAt: now,
          })
        : Promise.resolve(),
    ])

    return {
      ok: true as const,
      runId,
      threadId,
      userId,
    }
  },
})

export const recordSkipForWorker = mutation({
  args: {
    automationId: v.id("automations"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const automation = await ctx.db.get(args.automationId)
    if (!automation) return

    await ctx.db.patch(automation._id, {
      lastRunAt: Date.now(),
      lastRunStatus: "skipped",
      updatedAt: Date.now(),
    })
  },
})

export const recordDispatchFailureForWorker = mutation({
  args: {
    automationId: v.id("automations"),
    error: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const automation = await ctx.db.get(args.automationId)
    if (!automation) return

    await recordAutomationFailure(
      ctx,
      automation,
      "dispatch_failed",
      args.error
    )
  },
})

export const disableForWorker = mutation({
  args: {
    automationId: v.id("automations"),
    reason: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const automation = await ctx.db.get(args.automationId)
    if (!automation) return

    await disableAutomation(ctx, automation, args.reason)
  },
})

// Sliding-window cap on event-triggered fires: a webhook feedback loop (an
// automation whose run re-emits its own trigger event) stalls out instead of
// self-amplifying, keeping event-driven spend predictable.
const EVENT_FIRE_WINDOW_MS = 60 * 60_000
const EVENT_FIRE_WINDOW_MAX = 10

/** Enabled event automations matching any of the coarse source keys computed
 * from a webhook event. The caller applies the trigger's fine predicates
 * (channel, keyword, emoji, team, label, state, actor, branch) on the returned
 * rows. GitHub results are also restricted to the webhook installation's
 * owners here, before any run is claimed. */
export const workerMatchTriggeredAutomations = query({
  args: {
    githubInstallationId: v.optional(v.string()),
    sourceKeys: v.array(v.string()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const githubInstallationId = args.githubInstallationId
    const githubInstallationOwners = githubInstallationId
      ? new Set(
          (
            await ctx.db
              .query("githubAppInstallations")
              .withIndex("by_installation", (q) =>
                q.eq("installationId", githubInstallationId)
              )
              .collect()
          ).map((installation) => installation.userId)
        )
      : undefined

    const matched = new Map<
      string,
      {
        _id: Id<"automations">
        name: string
        trigger: NonNullable<Doc<"automations">["trigger"]>
        userId: Id<"users">
      }
    >()
    for (const sourceKey of args.sourceKeys.slice(0, 10)) {
      const rows = await ctx.db
        .query("automations")
        .withIndex("by_trigger_source", (q) =>
          q.eq("triggerSourceKey", sourceKey).eq("enabled", true)
        )
        .collect()
      for (const row of rows) {
        if (!row.trigger) continue
        if (
          row.trigger.kind === "github" &&
          (!githubInstallationOwners?.has(row.userId) ||
            (row.trigger.installationId &&
              row.trigger.installationId !== githubInstallationId))
        ) {
          continue
        }
        matched.set(row._id, {
          _id: row._id,
          name: row.name,
          trigger: row.trigger,
          userId: row.userId,
        })
      }
    }

    return [...matched.values()]
  },
})

/** Atomically deduplicates, rate-limits, and persists one provider event. The
 * event is counted only after it has a durable queue row, so an enqueue outage
 * can no longer spend the automation's hourly allowance without work to run. */
export const workerEnqueueEventFire = mutation({
  args: {
    automationId: v.id("automations"),
    eventKey: v.string(),
    eventVars: v.record(v.string(), v.string()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const automation = await ctx.db.get(args.automationId)
    if (!automation || !automation.enabled) {
      return { queued: false as const, reason: "disabled" as const }
    }

    const eventKey = args.eventKey.trim()
    if (!eventKey) throw new Error("eventKey is required.")
    const existing = await ctx.db
      .query("automationEventQueue")
      .withIndex("by_automation_event", (q) =>
        q.eq("automationId", automation._id).eq("eventKey", eventKey)
      )
      .unique()
    if (existing) {
      return {
        queueId: existing._id,
        queued: false as const,
        reason: "duplicate" as const,
      }
    }

    const pending = await ctx.db
      .query("automationEventQueue")
      .withIndex("by_automation_status_created", (q) =>
        q.eq("automationId", automation._id).eq("status", "pending")
      )
      .take(EVENT_QUEUE_MAX_PENDING)
    const dispatching = await ctx.db
      .query("automationEventQueue")
      .withIndex("by_automation_status_created", (q) =>
        q.eq("automationId", automation._id).eq("status", "dispatching")
      )
      .take(EVENT_QUEUE_MAX_PENDING)
    const created = await ctx.db
      .query("automationEventQueue")
      .withIndex("by_automation_status_created", (q) =>
        q.eq("automationId", automation._id).eq("status", "run_created")
      )
      .take(EVENT_QUEUE_MAX_PENDING)
    if (
      pending.length + dispatching.length + created.length >=
      EVENT_QUEUE_MAX_PENDING
    ) {
      await ctx.db.patch(automation._id, {
        lastRunError: `Event queue reached its ${EVENT_QUEUE_MAX_PENDING}-event limit.`,
        lastRunStatus: "dispatch_failed",
        updatedAt: Date.now(),
      })
      return { queued: false as const, reason: "queue_full" as const }
    }

    const now = Date.now()
    const windowStart = automation.eventFireWindowStart ?? 0
    const inWindow = now - windowStart < EVENT_FIRE_WINDOW_MS
    const count = inWindow ? (automation.eventFireCount ?? 0) : 0
    if (count >= EVENT_FIRE_WINDOW_MAX) {
      return { queued: false as const, reason: "rate_limited" as const }
    }

    const queueId = await ctx.db.insert("automationEventQueue", {
      automationId: automation._id,
      createdAt: now,
      eventKey,
      eventVars: args.eventVars,
      status: "pending",
      updatedAt: now,
    })
    await ctx.db.patch(automation._id, {
      eventFireCount: count + 1,
      eventFireWindowStart: inWindow ? windowStart : now,
      updatedAt: now,
    })
    return { queueId, queued: true as const }
  },
})

/** Claims only the oldest event for an idle automation. A dispatch lease
 * serializes racing drain tasks until automation-run has created its durable
 * Codex run or released the event. */
export const workerClaimQueuedEvent = mutation({
  args: {
    automationId: v.id("automations"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const automation = await ctx.db.get(args.automationId)
    if (!automation) {
      return { claimed: false as const, reason: "disabled" as const }
    }

    const now = Date.now()
    // A Codex run is persisted in the same transaction that moves its event
    // here. Recover that handoff before checking enabled/active state: once a
    // run exists, it must either reach cloudcode-run or be explicitly failed.
    const created = await ctx.db
      .query("automationEventQueue")
      .withIndex("by_automation_status_created", (q) =>
        q.eq("automationId", automation._id).eq("status", "run_created")
      )
      .first()
    if (created?.runId) {
      return {
        claimed: false as const,
        queueId: created._id,
        reason: "run_created" as const,
        runId: created.runId,
        userId: automation.userId,
      }
    }
    if (!automation.enabled) {
      return { claimed: false as const, reason: "disabled" as const }
    }

    const dispatching = await ctx.db
      .query("automationEventQueue")
      .withIndex("by_automation_status_created", (q) =>
        q.eq("automationId", automation._id).eq("status", "dispatching")
      )
      .first()
    if (dispatching) {
      if ((dispatching.dispatchLeaseExpiresAt ?? 0) > now) {
        return {
          claimed: false as const,
          reason: "dispatch_in_progress" as const,
        }
      }
      await ctx.db.patch(dispatching._id, {
        dispatchLeaseExpiresAt: undefined,
        status: "pending",
        updatedAt: now,
      })
    }

    const activeRun = await activeRunForThread(ctx, automation.threadId)
    if (activeRun) {
      return { claimed: false as const, reason: "active_run" as const }
    }

    const event = await ctx.db
      .query("automationEventQueue")
      .withIndex("by_automation_status_created", (q) =>
        q.eq("automationId", automation._id).eq("status", "pending")
      )
      .first()
    if (!event) return { claimed: false as const, reason: "empty" as const }

    await ctx.db.patch(event._id, {
      dispatchLeaseExpiresAt: now + EVENT_DISPATCH_LEASE_MS,
      status: "dispatching",
      updatedAt: now,
    })
    return {
      claimed: true as const,
      eventVars: event.eventVars,
      queueId: event._id,
    }
  },
})

export const workerReleaseQueuedEvent = mutation({
  args: {
    queueId: v.id("automationEventQueue"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const event = await ctx.db.get(args.queueId)
    if (!event || event.status !== "dispatching") {
      return { released: false }
    }
    await ctx.db.patch(event._id, {
      dispatchLeaseExpiresAt: undefined,
      status: "pending",
      updatedAt: Date.now(),
    })
    return { released: true }
  },
})

export const workerCompleteQueuedEvent = mutation({
  args: {
    queueId: v.id("automationEventQueue"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const event = await ctx.db.get(args.queueId)
    if (!event) return { completed: false }
    await ctx.db.patch(event._id, {
      dispatchLeaseExpiresAt: undefined,
      status: "started",
      updatedAt: Date.now(),
    })
    return { completed: true }
  },
})

/** Scheduler backstop for a worker that died after claiming a queue row or
 * before starting its drain task. */
export const workerRecoverEventQueues = mutation({
  args: {
    now: v.number(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const stale = await ctx.db
      .query("automationEventQueue")
      .withIndex("by_status_updated", (q) =>
        q
          .eq("status", "dispatching")
          .lt("updatedAt", args.now - EVENT_DISPATCH_LEASE_MS)
      )
      .take(EVENT_RECOVERY_LIMIT)
    for (const event of stale) {
      await ctx.db.patch(event._id, {
        dispatchLeaseExpiresAt: undefined,
        status: "pending",
        updatedAt: args.now,
      })
    }

    const pending = await ctx.db
      .query("automationEventQueue")
      .withIndex("by_status_updated", (q) => q.eq("status", "pending"))
      .take(EVENT_RECOVERY_LIMIT)
    const expiredDedupe = await ctx.db
      .query("automationEventQueue")
      .withIndex("by_status_updated", (q) =>
        q
          .eq("status", "started")
          .lt("updatedAt", args.now - EVENT_DEDUPE_RETENTION_MS)
      )
      .take(EVENT_RECOVERY_LIMIT)
    const created = await ctx.db
      .query("automationEventQueue")
      .withIndex("by_status_updated", (q) => q.eq("status", "run_created"))
      .take(EVENT_RECOVERY_LIMIT)
    // Rotate attempted rows to the end of the recovery index so a busy
    // automation cannot starve queues belonging to other automations.
    await Promise.all(
      [...pending, ...created].map((event) =>
        ctx.db.patch(event._id, { updatedAt: args.now })
      )
    )
    await Promise.all(expiredDedupe.map((event) => ctx.db.delete(event._id)))
    return {
      automationIds: [
        ...new Set(
          [...stale, ...pending, ...created].map((event) => event.automationId)
        ),
      ],
      recovered: stale.length + created.length,
    }
  },
})

/** Compare-and-set style fire claim for one event automation: bumps the
 * sliding-window counter and refuses once the cap is reached, so redelivered
 * or looping events cannot pile runs up. */
export const workerClaimEventFire = mutation({
  args: {
    automationId: v.id("automations"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const automation = await ctx.db.get(args.automationId)
    if (!automation || !automation.enabled) {
      return { claimed: false as const, reason: "disabled" as const }
    }

    const now = Date.now()
    const windowStart = automation.eventFireWindowStart ?? 0
    const inWindow = now - windowStart < EVENT_FIRE_WINDOW_MS
    const count = inWindow ? (automation.eventFireCount ?? 0) : 0
    if (count >= EVENT_FIRE_WINDOW_MAX) {
      return { claimed: false as const, reason: "rate_limited" as const }
    }

    await ctx.db.patch(automation._id, {
      eventFireCount: count + 1,
      eventFireWindowStart: inWindow ? windowStart : now,
      updatedAt: now,
    })
    return { claimed: true as const }
  },
})
