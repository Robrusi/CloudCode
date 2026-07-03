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
import { branchMode, model, speed, thinking } from "./lib/codexRunValidators"
import { resolveOwnedPresetOrAutoDefault } from "./lib/sandboxPresets"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"
import {
  codexAuthMissingMessage,
  codexAuthReconnectMessage,
} from "@/lib/codex/auth-errors"

// Guard against a stale client clock or a stale form submitting a nextRunAt
// that is already far in the past, which would fire immediately.
const NEXT_RUN_AT_PAST_TOLERANCE_MS = 5 * 60_000

const automationConfigArgs = {
  baseBranch: v.optional(v.string()),
  branchMode: v.optional(branchMode),
  branchName: v.optional(v.string()),
  cron: v.string(),
  model,
  name: v.string(),
  profile: v.optional(v.string()),
  prompt: v.string(),
  reasoningEffort: thinking,
  repoUrl: v.string(),
  sandboxPresetId: v.optional(v.id("sandboxPresets")),
  speed,
  timezone: v.string(),
}

type AutomationConfigArgs = {
  baseBranch?: string
  branchMode?: Doc<"automations">["branchMode"]
  branchName?: string
  cron: string
  model: Doc<"automations">["model"]
  name: string
  profile?: string
  prompt: string
  reasoningEffort: Doc<"automations">["reasoningEffort"]
  repoUrl: string
  sandboxPresetId?: Id<"sandboxPresets">
  speed: Doc<"automations">["speed"]
  timezone: string
}

function validateAutomationConfig(args: AutomationConfigArgs) {
  if (!args.name.trim()) throw new Error("name is required.")
  if (!args.prompt.trim()) throw new Error("prompt is required.")
  if (!args.cron.trim()) throw new Error("cron is required.")
  if (!args.timezone.trim()) throw new Error("timezone is required.")
  if (!args.repoUrl.trim()) throw new Error("repoUrl is required.")
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
    nextRunAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    validateAutomationConfig(args)
    validateNextRunAt(args.nextRunAt)
    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      args.sandboxPresetId,
      userId
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
      ...(trimmedBaseBranch ? { baseBranch: trimmedBaseBranch } : {}),
      ...(args.branchMode ? { branchMode: args.branchMode } : {}),
      ...(args.branchName?.trim()
        ? { branchName: args.branchName.trim() }
        : {}),
      createdAt: now,
      cron: args.cron.trim(),
      enabled: true,
      failureCount: 0,
      model: args.model,
      name: args.name.trim(),
      nextRunAt: args.nextRunAt,
      ...(args.profile ? { profile: args.profile } : {}),
      prompt: args.prompt.trim(),
      reasoningEffort: args.reasoningEffort,
      repoUrl: args.repoUrl,
      sandboxPresetId,
      speed: args.speed,
      threadId,
      timezone: args.timezone.trim(),
      updatedAt: now,
      userId,
    })

    return { automationId, threadId }
  },
})

export const update = mutation({
  args: {
    ...automationConfigArgs,
    automationId: v.id("automations"),
    nextRunAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    validateAutomationConfig(args)
    const automation = await requireOwnedAutomation(
      ctx,
      args.automationId,
      userId
    )
    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      args.sandboxPresetId,
      userId
    )

    const now = Date.now()
    const trimmedBaseBranch = args.baseBranch?.trim()
    if (automation.enabled) validateNextRunAt(args.nextRunAt)

    await Promise.all([
      ctx.db.patch(automation._id, {
        baseBranch: trimmedBaseBranch || undefined,
        branchMode: args.branchMode,
        branchName: args.branchName?.trim() || undefined,
        cron: args.cron.trim(),
        model: args.model,
        name: args.name.trim(),
        ...(automation.enabled ? { nextRunAt: args.nextRunAt } : {}),
        profile: args.profile,
        prompt: args.prompt.trim(),
        reasoningEffort: args.reasoningEffort,
        repoUrl: args.repoUrl,
        sandboxPresetId,
        speed: args.speed,
        timezone: args.timezone.trim(),
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
      if (args.nextRunAt === undefined) {
        throw new Error("nextRunAt is required when enabling an automation.")
      }
      validateNextRunAt(args.nextRunAt)
      await ctx.db.patch(automation._id, {
        disabledReason: undefined,
        enabled: true,
        failureCount: 0,
        nextRunAt: args.nextRunAt,
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

    // The thread and its run history survive as a normal chat.
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

    return due.map((automation) => ({
      _id: automation._id,
      cron: automation.cron,
      nextRunAt: automation.nextRunAt!,
      timezone: automation.timezone,
      userId: automation.userId,
    }))
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
      automation.userId
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
    await ctx.db.insert("messages", {
      content: automation.prompt,
      role: "user",
      threadId: automation.threadId,
      userId,
    })
    const assistantMessageId = await ctx.db.insert("messages", {
      content: "",
      pending: true,
      role: "assistant",
      speed: automation.speed,
      thinking: automation.reasoningEffort,
      threadId: automation.threadId,
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
      ephemeralSandbox: true,
      model: automation.model,
      profile: auth.profile,
      reasoningEffort: automation.reasoningEffort,
      repoUrl: automation.repoUrl,
      sandboxPresetId,
      speed: automation.speed,
      status: "queued",
      threadId: automation.threadId,
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
        prompt: automation.prompt,
        runId,
        userId,
      }),
      upsertCodexRunCheckpoint(
        ctx,
        { _id: runId, threadId: automation.threadId, userId },
        { content: "" }
      ),
      appendCodexRunLogs(
        ctx,
        { _id: runId, threadId: automation.threadId, userId },
        [queuedLog]
      ),
      ctx.db.patch(automation.threadId, {
        hasPendingMessage: true,
        lastUserMessageAt: now,
        updatedAt: now,
      }),
      ctx.db.patch(automation._id, {
        lastRunAt: now,
        lastRunError: undefined,
        lastRunStatus: "running",
        updatedAt: now,
      }),
    ])

    return {
      ok: true as const,
      runId,
      threadId: automation.threadId,
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
