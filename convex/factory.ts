import { v } from "convex/values"

import { api, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { findCodexAuth } from "./lib/codexRunAuth"
import {
  activeRunForThread,
  failRunBeforeStart,
  isActiveCodexRunStatus,
} from "./lib/codexRunLifecycle"
import { codexRunCheckpoint, codexRunInput } from "./lib/codexRunRecords"
import {
  countActiveDispatchedRuns,
  factoryAccessArgs,
  factoryRootThreadId,
  isRunInFactoryTree,
  requireActiveFactoryRunAccess,
  requireFactoryRunAccess,
} from "./lib/factoryAccess"
import {
  insertFactoryRunRecords,
  type FactoryRunCreated,
} from "./lib/factoryRuns"
import { automationTriggerOf } from "./lib/integrationTriggers"
import { resolveOwnedPresetOrAutoDefault } from "./lib/sandboxPresets"
import { threadContinuationInput } from "./lib/threadContinuation"
import { triggerTaskViaApi } from "./lib/triggerApi"
import { requireWorkerSecret, workerSecretFromEnv } from "./lib/workerAuth"
import {
  nextRunAtAfter,
  validateAutomationCron,
  validateAutomationTimezone,
} from "@/lib/automations/schedule"
import {
  MODELS,
  assertModelSupportsThinking,
  normalizeThinkingForModel,
  parseModel,
  type Model,
} from "@/lib/chat/options"
import {
  codexAuthMissingMessage,
  codexAuthReconnectMessage,
} from "@/lib/codex/auth-errors"
import { finalRunMessageFromContent } from "@/lib/codex/run-log"
import {
  CODEX_REASONING_EFFORT_ERROR,
  CODEX_SPEED_ERROR,
  parseCodexReasoningEffort,
  parseCodexSpeed,
  type CodexSpeed,
  type ReasoningEffort,
} from "@/lib/codex/run-options"
import {
  FACTORY_MAX_ACTIVE_DISPATCHED_RUNS_PER_USER,
  FACTORY_MAX_AGENT_CREATED_AUTOMATIONS,
  FACTORY_MAX_DISPATCHES_PER_ROOT_THREAD,
  FACTORY_MAX_SPAWN_DEPTH,
} from "@/lib/factory/limits"

const BILLING_EXHAUSTED_ERROR =
  "Infrastructure usage is exhausted. The dispatched run was not created."

const THREAD_TITLE_MAX_LENGTH = 120
const RUN_OUTPUT_MAX_LENGTH = 8000
const AUTOMATION_PROMPT_PREVIEW_LENGTH = 300

const dispatchParamArgs = {
  baseBranch: v.optional(v.string()),
  branchMode: v.optional(v.string()),
  branchName: v.optional(v.string()),
  model: v.optional(v.string()),
  notifyParent: v.optional(v.boolean()),
  prompt: v.string(),
  reasoningEffort: v.optional(v.string()),
  sandboxRetention: v.optional(v.string()),
  speed: v.optional(v.string()),
  title: v.optional(v.string()),
}

const messageParamArgs = {
  model: v.optional(v.string()),
  notifyParent: v.optional(v.boolean()),
  prompt: v.string(),
  reasoningEffort: v.optional(v.string()),
  speed: v.optional(v.string()),
  targetThreadId: v.id("threads"),
}

const FACTORY_BRANCH_MODES = ["auto", "base", "custom"] as const

function parseFactoryModel(value: string | undefined, fallback: Model): Model {
  if (!value) return fallback
  const parsed = parseModel(value)
  if (parsed) return parsed
  throw new Error(`model must be one of ${MODELS.join(", ")}.`)
}

function parseFactoryEffort(
  value: string | undefined,
  fallback: ReasoningEffort,
  model: Model
): ReasoningEffort {
  if (!value) return normalizeThinkingForModel(model, fallback)
  const parsed = parseCodexReasoningEffort(value)
  if (!parsed) throw new Error(CODEX_REASONING_EFFORT_ERROR)
  assertModelSupportsThinking(model, parsed)
  return parsed
}

function parseFactorySpeed(
  value: string | undefined,
  fallback: CodexSpeed
): CodexSpeed {
  if (!value) return fallback
  const parsed = parseCodexSpeed(value)
  if (!parsed) throw new Error(CODEX_SPEED_ERROR)
  return parsed
}

function parseFactoryChoice<T extends string>(
  value: string | undefined,
  choices: readonly T[],
  label: string
): T | undefined {
  if (!value) return undefined
  if ((choices as readonly string[]).includes(value)) return value as T
  throw new Error(`${label} must be one of ${choices.join(", ")}.`)
}

function dispatchThreadTitle(title: string | undefined, prompt: string) {
  const base =
    title?.trim() || prompt.split("\n", 1)[0]?.trim() || "Dispatched run"
  return base.length > THREAD_TITLE_MAX_LENGTH
    ? `${base.slice(0, THREAD_TITLE_MAX_LENGTH)}…`
    : base
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

async function runSummary(ctx: QueryCtx, run: Doc<"codexRuns">) {
  const thread = await ctx.db.get(run.threadId)

  return {
    branchName: run.branchName,
    createdAt: run.createdAt,
    error: run.error,
    finishedAt: run.finishedAt,
    prUrl: run.prUrl,
    runId: run._id,
    spawnDepth: run.spawnDepth,
    status: run.status,
    threadId: run.threadId,
    title: thread?.title,
  }
}

/** Transactional spawn guards. Enforced inside the creating mutation so
 * concurrent dispatches cannot race past the caps. */
async function requireSpawnCapacity(
  ctx: MutationCtx,
  parent: Doc<"codexRuns">
) {
  const spawnDepth = (parent.spawnDepth ?? 0) + 1
  if (spawnDepth > FACTORY_MAX_SPAWN_DEPTH) {
    throw new Error(
      `Dispatch depth limit reached (${FACTORY_MAX_SPAWN_DEPTH}). This run cannot spawn further runs.`
    )
  }

  const rootThreadId = factoryRootThreadId(parent)
  const dispatched = await ctx.db
    .query("codexRuns")
    .withIndex("by_root_thread", (q) => q.eq("rootThreadId", rootThreadId))
    .collect()
  if (dispatched.length >= FACTORY_MAX_DISPATCHES_PER_ROOT_THREAD) {
    throw new Error(
      `This dispatch tree already created ${FACTORY_MAX_DISPATCHES_PER_ROOT_THREAD} runs, which is the limit.`
    )
  }

  const active = await countActiveDispatchedRuns(ctx, parent.userId)
  if (active >= FACTORY_MAX_ACTIVE_DISPATCHED_RUNS_PER_USER) {
    throw new Error(
      `There are already ${active} dispatched runs active (limit ${FACTORY_MAX_ACTIVE_DISPATCHED_RUNS_PER_USER}). Wait for some to finish (run_list shows their status) and try again.`
    )
  }

  return { rootThreadId, spawnDepth }
}

async function requireDispatchAuth(
  ctx: MutationCtx,
  userId: Id<"users">,
  profile: string | undefined
) {
  const { auth, profile: authProfile } = await findCodexAuth(
    ctx,
    userId,
    profile,
    { fallbackToActive: true }
  )
  if (!auth) throw new Error(codexAuthMissingMessage(authProfile))
  if (auth.invalidatedAt) {
    throw new Error(codexAuthReconnectMessage(authProfile))
  }

  return auth
}

const DISPATCH_QUEUED_LOG = "Queued dispatched Codex run"

// ---------------------------------------------------------------------------
// Tool-facing queries (authenticated by the per-run access token).
// ---------------------------------------------------------------------------

export const listRuns = query({
  args: factoryAccessArgs,
  handler: async (ctx, args) => {
    const run = await requireFactoryRunAccess(ctx, args)
    const rootThreadId = factoryRootThreadId(run)

    const runs = await ctx.db
      .query("codexRuns")
      .withIndex("by_root_thread", (q) => q.eq("rootThreadId", rootThreadId))
      .order("desc")
      .take(FACTORY_MAX_DISPATCHES_PER_ROOT_THREAD)

    return await Promise.all(runs.map((child) => runSummary(ctx, child)))
  },
})

export const getRunStatus = query({
  args: {
    ...factoryAccessArgs,
    targetRunId: v.id("codexRuns"),
  },
  handler: async (ctx, args) => {
    const run = await requireFactoryRunAccess(ctx, args)
    const target = await ctx.db.get(args.targetRunId)
    if (!target || !isRunInFactoryTree(run, target)) return null

    return await runSummary(ctx, target)
  },
})

export const getRunOutput = query({
  args: {
    ...factoryAccessArgs,
    targetRunId: v.id("codexRuns"),
  },
  handler: async (ctx, args) => {
    const run = await requireFactoryRunAccess(ctx, args)
    const target = await ctx.db.get(args.targetRunId)
    if (!target || !isRunInFactoryTree(run, target)) return null

    // Finished runs store the final content on the assistant message; live
    // runs stream into the checkpoint.
    const [message, checkpoint] = await Promise.all([
      ctx.db.get(target.assistantMessageId),
      codexRunCheckpoint(ctx, target._id),
    ])
    const content =
      (message && !message.pending ? message.content : undefined) ??
      checkpoint?.content ??
      target.content ??
      ""
    const output = finalRunMessageFromContent(content)
    const truncated = output.length > RUN_OUTPUT_MAX_LENGTH

    return {
      // The tail is the freshest part of a streaming run and holds the final
      // message of a finished one.
      output: truncated ? output.slice(-RUN_OUTPUT_MAX_LENGTH) : output,
      pending: isActiveCodexRunStatus(target.status),
      runId: target._id,
      status: target.status,
      truncated,
    }
  },
})

export const listAutomations = query({
  args: factoryAccessArgs,
  handler: async (ctx, args) => {
    const run = await requireFactoryRunAccess(ctx, args)

    const automations = await ctx.db
      .query("automations")
      .withIndex("by_user_updated", (q) => q.eq("userId", run.userId))
      .order("desc")
      .collect()

    return automations
      .filter((automation) => automation.repoUrl === run.repoUrl)
      .map((automation) => ({
        agentCreated: Boolean(automation.createdByRunId),
        automationId: automation._id,
        cron: automation.cron,
        enabled: automation.enabled,
        lastRunStatus: automation.lastRunStatus,
        name: automation.name,
        nextRunAt: automation.nextRunAt,
        promptPreview: truncate(
          automation.prompt,
          AUTOMATION_PROMPT_PREVIEW_LENGTH
        ),
        timezone: automation.timezone,
      }))
  },
})

// ---------------------------------------------------------------------------
// Tool-facing mutations (cron self-setup).
// ---------------------------------------------------------------------------

export const createAutomation = mutation({
  args: {
    ...factoryAccessArgs,
    cron: v.string(),
    model: v.optional(v.string()),
    name: v.optional(v.string()),
    prompt: v.string(),
    reasoningEffort: v.optional(v.string()),
    sandboxRetention: v.optional(v.string()),
    speed: v.optional(v.string()),
    threadMode: v.optional(v.string()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await requireActiveFactoryRunAccess(ctx, args)
    const prompt = args.prompt.trim()
    if (!prompt) throw new Error("prompt is required.")
    const cron = validateAutomationCron(args.cron)
    const timezone = validateAutomationTimezone(args.timezone ?? "UTC")
    const model = parseFactoryModel(args.model, run.model)
    const reasoningEffort = parseFactoryEffort(
      args.reasoningEffort,
      run.reasoningEffort,
      model
    )
    const speed = parseFactorySpeed(args.speed, run.speed)
    const threadMode = parseFactoryChoice(
      args.threadMode,
      ["single", "per-run"] as const,
      "threadMode"
    )
    const sandboxRetention = parseFactoryChoice(
      args.sandboxRetention,
      ["delete", "idle"] as const,
      "sandboxRetention"
    )

    const existing = await ctx.db
      .query("automations")
      .withIndex("by_user_updated", (q) => q.eq("userId", run.userId))
      .collect()
    const agentCreatedEnabled = existing.filter(
      (automation) => automation.createdByRunId && automation.enabled
    )
    if (agentCreatedEnabled.length >= FACTORY_MAX_AGENT_CREATED_AUTOMATIONS) {
      throw new Error(
        `There are already ${agentCreatedEnabled.length} enabled agent-created automations (limit ${FACTORY_MAX_AGENT_CREATED_AUTOMATIONS}). Disable one before creating another.`
      )
    }

    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      run.sandboxPresetId,
      run.userId
    )
    const now = Date.now()
    const name = dispatchThreadTitle(args.name, prompt)
    const nextRunAt = nextRunAtAfter(cron, timezone, now)

    const threadId = await ctx.db.insert("threads", {
      createdAt: now,
      model,
      repoUrl: run.repoUrl,
      sandboxPresetId,
      title: name,
      updatedAt: now,
      userId: run.userId,
    })
    const automationId = await ctx.db.insert("automations", {
      createdAt: now,
      createdByRunId: run._id,
      cron,
      enabled: true,
      failureCount: 0,
      model,
      name,
      nextRunAt,
      ...(run.profile ? { profile: run.profile } : {}),
      prompt,
      reasoningEffort,
      repoUrl: run.repoUrl,
      sandboxPresetId,
      ...(sandboxRetention ? { sandboxRetention } : {}),
      speed,
      threadId,
      ...(threadMode ? { threadMode } : {}),
      timezone,
      trigger: { cron, kind: "cron", timezone },
      triggerKind: "cron",
      updatedAt: now,
      userId: run.userId,
    })
    await ctx.db.patch(threadId, { automationId })

    return { automationId, cron, name, nextRunAt, timezone }
  },
})

export const setAutomationEnabled = mutation({
  args: {
    ...factoryAccessArgs,
    automationId: v.id("automations"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const run = await requireActiveFactoryRunAccess(ctx, args)
    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.userId !== run.userId) {
      throw new Error("Automation not found.")
    }
    // User-created automations stay under the user's control only.
    if (!automation.createdByRunId) {
      throw new Error(
        "Factory tools may only enable or disable automations they created."
      )
    }

    const now = Date.now()
    if (args.enabled) {
      // Factory tools only create cron automations, so the trigger always
      // reads as the cron kind here.
      const trigger = automationTriggerOf(automation)
      await ctx.db.patch(automation._id, {
        disabledReason: undefined,
        enabled: true,
        failureCount: 0,
        nextRunAt:
          trigger.kind === "cron"
            ? nextRunAtAfter(trigger.cron, trigger.timezone, now)
            : undefined,
        updatedAt: now,
      })
      return { enabled: true }
    }

    await ctx.db.patch(automation._id, {
      disabledReason: undefined,
      enabled: false,
      nextRunAt: undefined,
      updatedAt: now,
    })
    return { enabled: false }
  },
})

// ---------------------------------------------------------------------------
// Dispatch internals.
// ---------------------------------------------------------------------------

export const workerAccessContext = internalQuery({
  args: factoryAccessArgs,
  handler: async (ctx, args) => {
    const run = await requireActiveFactoryRunAccess(ctx, args)
    return { userId: run.userId }
  },
})

export const workerCreateDispatchedRun = internalMutation({
  args: {
    ...factoryAccessArgs,
    ...dispatchParamArgs,
  },
  handler: async (ctx, args): Promise<FactoryRunCreated> => {
    const parent = await requireActiveFactoryRunAccess(ctx, args)
    const prompt = args.prompt.trim()
    if (!prompt) throw new Error("prompt is required.")

    const branchMode =
      parseFactoryChoice(args.branchMode, FACTORY_BRANCH_MODES, "branchMode") ??
      "auto"
    const branchName = args.branchName?.trim() || undefined
    if (branchMode === "custom" && !branchName) {
      throw new Error("branchName is required when branchMode is custom.")
    }
    const baseBranch = args.baseBranch?.trim() || parent.baseBranch
    const model = parseFactoryModel(args.model, parent.model)
    const reasoningEffort = parseFactoryEffort(
      args.reasoningEffort,
      parent.reasoningEffort,
      model
    )
    const speed = parseFactorySpeed(args.speed, parent.speed)
    // Children keep their sandbox by default (it pauses on the user's idle
    // timeout) so run_message rework resumes hot; the dispatcher deletes it
    // with sandbox_delete once the child's work is accepted, or opts into
    // delete-at-run-end for fire-and-forget tasks.
    const sandboxRetention =
      parseFactoryChoice(
        args.sandboxRetention,
        ["delete", "idle"] as const,
        "sandboxRetention"
      ) ?? "idle"

    const { rootThreadId, spawnDepth } = await requireSpawnCapacity(ctx, parent)
    const auth = await requireDispatchAuth(ctx, parent.userId, parent.profile)
    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      parent.sandboxPresetId,
      parent.userId
    )

    const now = Date.now()
    const threadId = await ctx.db.insert("threads", {
      ...(baseBranch ? { baseBranch } : {}),
      branchMode,
      createdAt: now,
      factoryRootThreadId: rootThreadId,
      model,
      repoUrl: parent.repoUrl,
      sandboxPresetId,
      title: dispatchThreadTitle(args.title, prompt),
      updatedAt: now,
      userId: parent.userId,
    })

    return await insertFactoryRunRecords(ctx, {
      baseBranch,
      branchMode,
      branchName,
      ephemeralSandbox: sandboxRetention === "delete",
      logMessage: DISPATCH_QUEUED_LOG,
      model,
      notifyParent: args.notifyParent ?? true,
      parentRunId: parent._id,
      parentThreadId: parent.threadId,
      profile: auth.profile,
      prompt,
      reasoningEffort,
      repoUrl: parent.repoUrl,
      rootThreadId,
      sandboxPresetId,
      spawnDepth,
      speed,
      threadId,
      userId: parent.userId,
    })
  },
})

export const workerCreateFollowUpRun = internalMutation({
  args: {
    ...factoryAccessArgs,
    ...messageParamArgs,
  },
  handler: async (ctx, args): Promise<FactoryRunCreated> => {
    const parent = await requireActiveFactoryRunAccess(ctx, args)
    const prompt = args.prompt.trim()
    if (!prompt) throw new Error("prompt is required.")

    const target = await ctx.db.get(args.targetThreadId)
    if (!target || target.userId !== parent.userId) {
      throw new Error("Thread not found.")
    }
    const continuation = await threadContinuationInput(ctx, target)
    const latest = continuation.latest
    const rootThreadId = factoryRootThreadId(parent)
    if (!latest || latest.rootThreadId !== rootThreadId) {
      throw new Error(
        "run_message can only message threads that were dispatched from this run's tree."
      )
    }
    if (target.hasPendingMessage) {
      const activeRun = await activeRunForThread(ctx, target._id)
      if (activeRun) {
        throw new Error(
          "A run is still active on that thread. Check run_status and retry after it finishes."
        )
      }
    }

    const model = parseFactoryModel(args.model, latest.model)
    const reasoningEffort = parseFactoryEffort(
      args.reasoningEffort,
      latest.reasoningEffort,
      model
    )
    const speed = parseFactorySpeed(args.speed, latest.speed)

    const { spawnDepth } = await requireSpawnCapacity(ctx, parent)
    const auth = await requireDispatchAuth(ctx, parent.userId, latest.profile)
    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      latest.sandboxPresetId ?? target.sandboxPresetId,
      parent.userId
    )

    return await insertFactoryRunRecords(ctx, {
      baseBranch: target.baseBranch ?? latest.baseBranch,
      branchMode: parseFactoryChoice(
        target.branchMode ?? latest.branchMode,
        FACTORY_BRANCH_MODES,
        "branchMode"
      ),
      branchName: latest.branchName,
      codexThreadId: continuation.codexThreadId,
      ephemeralSandbox: latest.ephemeralSandbox,
      logMessage: DISPATCH_QUEUED_LOG,
      model,
      notifyParent: args.notifyParent ?? true,
      parentRunId: parent._id,
      parentThreadId: parent.threadId,
      previousDiff: continuation.previousDiff,
      profile: auth.profile,
      prompt,
      reasoningEffort,
      repoUrl: latest.repoUrl,
      rootThreadId,
      sandboxId: continuation.sandboxId,
      sandboxPresetId,
      spawnDepth,
      speed,
      threadId: target._id,
      userId: parent.userId,
    })
  },
})

/** Scope check for sandbox_delete: the target must be a finished dispatched
 * thread in the caller's tree that still has a live sandbox. Returns null
 * when there is nothing to delete. */
export const workerSandboxDeleteContext = internalQuery({
  args: {
    ...factoryAccessArgs,
    targetThreadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const caller = await requireActiveFactoryRunAccess(ctx, args)
    const target = await ctx.db.get(args.targetThreadId)
    if (!target || target.userId !== caller.userId) {
      throw new Error("Thread not found.")
    }
    const latest = await ctx.db
      .query("codexRuns")
      .withIndex("by_thread_updated", (q) =>
        q.eq("threadId", args.targetThreadId)
      )
      .order("desc")
      .first()
    if (!latest || latest.rootThreadId !== factoryRootThreadId(caller)) {
      throw new Error(
        "sandbox_delete can only target threads dispatched from this run's tree."
      )
    }
    const activeRun = await activeRunForThread(ctx, args.targetThreadId)
    if (activeRun) {
      throw new Error(
        "A run is still active on that thread; wait for it to finish before deleting its sandbox."
      )
    }
    if (!target.sandboxId || target.sandboxState === "deleted") return null

    return {
      latestRunId: latest._id,
      sandboxId: target.sandboxId,
      userId: caller.userId,
    }
  },
})

export const deleteThreadSandbox = action({
  args: {
    ...factoryAccessArgs,
    targetThreadId: v.id("threads"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ queued: boolean; sandboxId?: string }> => {
    const context = await ctx.runQuery(
      internal.factory.workerSandboxDeleteContext,
      args
    )
    if (!context) return { queued: false }

    // Daytona deletion needs the SDK, which lives in the Trigger worker; the
    // task also records the billing segment end and clears the thread's
    // sandbox pointers.
    await triggerTaskViaApi({
      idempotencyKey: `factory-sandbox-delete:${context.sandboxId}`,
      payload: {
        runId: context.latestRunId,
        sandboxId: context.sandboxId,
        userId: context.userId,
      },
      tags: [`user:${context.userId}`, `thread:${args.targetThreadId}`],
      taskId: "factory-sandbox-delete",
    })

    return { queued: true, sandboxId: context.sandboxId }
  },
})

// ---------------------------------------------------------------------------
// Worker functions for the factory-dispatch Trigger task.
// ---------------------------------------------------------------------------

export const workerGetDispatchRun = query({
  args: {
    runId: v.id("codexRuns"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const run = await ctx.db.get(args.runId)
    if (!run) return null

    return {
      repoUrl: run.repoUrl,
      runId: run._id,
      status: run.status,
      threadId: run.threadId,
      userId: run.userId,
    }
  },
})

export const workerAttachDispatchCredential = mutation({
  args: {
    githubToken: v.optional(v.string()),
    githubUserEmail: v.optional(v.string()),
    githubUserName: v.optional(v.string()),
    githubUsername: v.optional(v.string()),
    runId: v.id("codexRuns"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const run = await ctx.db.get(args.runId)
    if (!run) return
    const input = await codexRunInput(ctx, run._id)

    await Promise.all([
      input && args.githubToken
        ? ctx.db.patch(input._id, { githubToken: args.githubToken })
        : Promise.resolve(),
      ctx.db.patch(run._id, {
        ...(args.githubUserEmail
          ? { githubUserEmail: args.githubUserEmail }
          : {}),
        ...(args.githubUserName ? { githubUserName: args.githubUserName } : {}),
        ...(args.githubUsername ? { githubUsername: args.githubUsername } : {}),
        updatedAt: Date.now(),
      }),
    ])
  },
})

export const workerFailDispatch = mutation({
  args: {
    error: v.string(),
    runId: v.id("codexRuns"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const run = await ctx.db.get(args.runId)
    if (!run) return
    await failRunBeforeStart(ctx, run, args.error)
  },
})

// ---------------------------------------------------------------------------
// Tool-facing actions: create the run, then queue the factory-dispatch task
// that mints the GitHub credential and hands off to cloudcode-run.
// ---------------------------------------------------------------------------

async function queueFactoryDispatch(
  ctx: ActionCtx,
  created: FactoryRunCreated,
  workerSecret: string
) {
  try {
    await triggerTaskViaApi({
      idempotencyKey: `factory-dispatch:${created.runId}`,
      payload: { runId: created.runId },
      tags: [`user:${created.userId}`, `thread:${created.threadId}`],
      taskId: "factory-dispatch",
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to queue the run."
    await ctx
      .runMutation(api.factory.workerFailDispatch, {
        error: message,
        runId: created.runId,
        workerSecret,
      })
      .catch(() => undefined)
    throw new Error(message)
  }
}

async function requireDispatchBilling(
  ctx: ActionCtx,
  args: { accessToken: string; runId: Id<"codexRuns">; threadId: Id<"threads"> }
) {
  const context = await ctx.runQuery(internal.factory.workerAccessContext, {
    accessToken: args.accessToken,
    runId: args.runId,
    threadId: args.threadId,
  })
  const workerSecret = workerSecretFromEnv()
  const billing = await ctx.runAction(api.billing.checkInfraAccessForWorker, {
    userId: context.userId,
    workerSecret,
  })
  if (!billing.allowed) throw new Error(BILLING_EXHAUSTED_ERROR)

  return workerSecret
}

export const dispatchRun = action({
  args: {
    ...factoryAccessArgs,
    ...dispatchParamArgs,
  },
  handler: async (
    ctx,
    args
  ): Promise<{ runId: string; status: string; threadId: string }> => {
    const workerSecret = await requireDispatchBilling(ctx, args)
    const created: FactoryRunCreated = await ctx.runMutation(
      internal.factory.workerCreateDispatchedRun,
      args
    )
    await queueFactoryDispatch(ctx, created, workerSecret)

    return {
      runId: created.runId,
      status: "queued",
      threadId: created.threadId,
    }
  },
})

export const messageThread = action({
  args: {
    ...factoryAccessArgs,
    ...messageParamArgs,
  },
  handler: async (
    ctx,
    args
  ): Promise<{ runId: string; status: string; threadId: string }> => {
    const workerSecret = await requireDispatchBilling(ctx, args)
    const created: FactoryRunCreated = await ctx.runMutation(
      internal.factory.workerCreateFollowUpRun,
      args
    )
    await queueFactoryDispatch(ctx, created, workerSecret)

    return {
      runId: created.runId,
      status: "queued",
      threadId: created.threadId,
    }
  },
})

// One-off backfill: stamp factoryRootThreadId onto threads created by
// dispatched runs before threads carried the flag. Idempotent; skips the
// root thread itself.
export const backfillThreadFactoryRoots = internalMutation({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db
      .query("codexRuns")
      .filter((q) => q.neq(q.field("rootThreadId"), undefined))
      .collect()

    let patched = 0
    const seen = new Set<string>()
    for (const run of runs) {
      if (!run.rootThreadId || seen.has(run.threadId as string)) continue
      seen.add(run.threadId as string)
      if (run.rootThreadId === run.threadId) continue
      const thread = await ctx.db.get(run.threadId)
      if (thread && !thread.factoryRootThreadId) {
        await ctx.db.patch(run.threadId, {
          factoryRootThreadId: run.rootThreadId,
        })
        patched += 1
      }
    }

    return { dispatchedRuns: runs.length, patched }
  },
})
