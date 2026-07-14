import { v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx } from "./_generated/server"
import {
  disableAutomation,
  recordAutomationFailure,
} from "./lib/automationRecords"
import { activeRunForThread } from "./lib/codexRunLifecycle"
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
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"
import {
  codexAuthMissingMessage,
  codexAuthReconnectMessage,
} from "@/lib/codex/auth-errors"
import { LINEAR_COMMENT_AUTHOR_FILTER_MAX } from "@/lib/automations/linear-comment-trigger"
import { assertModelSupportsThinking } from "@/lib/chat/options"

// Guard against a stale client clock or a stale form submitting a nextRunAt
// that is already far in the past, which would fire immediately.
const NEXT_RUN_AT_PAST_TOLERANCE_MS = 5 * 60_000
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
    if (!trigger.cron.trim()) throw new Error("cron is required.")
    if (!trigger.timezone.trim()) throw new Error("timezone is required.")
    return {
      cron: trigger.cron.trim(),
      kind: "cron",
      timezone: trigger.timezone.trim(),
    }
  }

  if (trigger.kind === "github") {
    return {
      ...trigger,
      actorLogin:
        trigger.actorLogin?.trim().replace(/^@/, "").toLowerCase() || undefined,
      branch: trigger.branch?.trim().replace(/^refs\/heads\//, "") || undefined,
    }
  }

  const installation = await ctx.db.get(trigger.installationId)
  if (
    !installation ||
    installation.userId !== userId ||
    installation.provider !== trigger.kind
  ) {
    throw new Error("Connect the integration before using it as a trigger.")
  }

  if (trigger.kind === "slack") {
    if (trigger.event === "keyword" && !trigger.keyword?.trim()) {
      throw new Error("keyword is required for keyword triggers.")
    }
    if (trigger.event === "reaction" && !trigger.emoji?.trim()) {
      throw new Error("emoji is required for reaction triggers.")
    }
    return {
      ...trigger,
      emoji: trigger.emoji?.trim().replace(/^:|:$/g, "") || undefined,
      keyword: trigger.keyword?.trim() || undefined,
    }
  }

  if (trigger.event === "labelAdded" && !trigger.labelId?.trim()) {
    throw new Error("labelId is required for label triggers.")
  }
  if (trigger.event === "issueAssigned" && !trigger.assigneeId?.trim()) {
    throw new Error("assigneeId is required for assignment triggers.")
  }
  if (trigger.event === "commentCreated") {
    const commentAuthorMode = trigger.commentAuthorMode ?? "any"
    const commentAuthorIds = [
      ...new Set(
        (trigger.commentAuthorIds ?? []).map((id) => id.trim()).filter(Boolean)
      ),
    ]
    if (commentAuthorIds.length > LINEAR_COMMENT_AUTHOR_FILTER_MAX) {
      throw new Error(
        `Choose at most ${LINEAR_COMMENT_AUTHOR_FILTER_MAX} comment authors.`
      )
    }
    if (commentAuthorMode !== "any" && commentAuthorIds.length === 0) {
      throw new Error("Choose at least one comment author.")
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
  if (!args.name.trim()) throw new Error("name is required.")
  if (!args.prompt.trim()) throw new Error("prompt is required.")
  if (!args.repoUrl.trim()) throw new Error("repoUrl is required.")
  assertModelSupportsThinking(args.model, args.reasoningEffort)
}

function validateNextRunAt(nextRunAt: number) {
  if (nextRunAt < Date.now() - NEXT_RUN_AT_PAST_TOLERANCE_MS) {
    throw new Error("nextRunAt is in the past.")
  }
}

async function requireOwnedAutomation(
  ctx: MutationCtx,
  automationId: Id<"automations">,
  userId: Id<"users">
) {
  const automation = await ctx.db.get(automationId)
  if (!automation || automation.userId !== userId) {
    throw new Error("Automation not found.")
  }

  return automation
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
        throw new Error("nextRunAt is required for scheduled automations.")
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
        throw new Error("nextRunAt is required for scheduled automations.")
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
        throw new Error("nextRunAt is required when enabling an automation.")
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
        finishedAt: run.finishedAt,
        id: run._id,
        status: run.status,
        threadId: run.threadId,
      })),
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
        .take(50)
      for (const row of rows) {
        if (!row.trigger) continue
        if (
          row.trigger.kind === "github" &&
          !githubInstallationOwners?.has(row.userId)
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
