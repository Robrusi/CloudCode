import { v, type Infer } from "convex/values"

import type { Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx } from "./_generated/server"
import { compactMessageMeta, compactRunLogs } from "./lib/codexRunLogs"
import {
  activeRunForThread,
  markRunCanceled,
  markRunCanceling,
  sandboxIdFromLog,
  TERMINAL_RUN_STATUSES,
} from "./lib/codexRunLifecycle"
import {
  codexRunCheckpoint,
  upsertCodexRunCheckpoint,
} from "./lib/codexRunRecords"
import { findCodexAuth } from "./lib/codexRunAuth"
import { workerInputForRun } from "./lib/codexRunWorkerInput"
import {
  codexAuthMissingMessage,
  codexAuthReconnectMessage,
} from "@/lib/codex/auth-errors"
import {
  branchMode,
  imageAttachment,
  model,
  runLog,
  speed,
  thinking,
  workerSandboxState as sandboxState,
} from "./lib/codexRunValidators"
import { sandboxAccessForUser } from "./lib/sandboxAccess"
import { resolveOwnedPresetOrAutoDefault } from "./lib/sandboxPresets"
import {
  requireOwnedAssistantMessage,
  requireOwnedThread,
} from "./lib/threadAccess"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"

export const liveForThread = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== user._id) return null

    const run = await activeRunForThread(ctx, args.threadId)
    if (!run || run.userId !== user._id) return null

    const message = await ctx.db.get(run.assistantMessageId)
    const runLogs = compactRunLogs(run.logs)
    const messageLogs = compactRunLogs(message?.meta?.logs)

    return {
      assistantMessageId: run.assistantMessageId,
      branch: run.branchName,
      codexThreadId: run.codexThreadId,
      content: run.content ?? message?.content ?? "",
      error: run.error,
      logs: runLogs.length ? runLogs : messageLogs,
      pending: true,
      runId: run._id,
      sandboxId: run.sandboxId,
      sandboxState: run.sandboxState,
      status: run.status,
      threadId: run.threadId,
      triggerRunId: run.triggerRunId,
      updatedAt: run.updatedAt,
    }
  },
})

export const ownsSandbox = query({
  args: {
    sandboxId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return false

    return Boolean(await sandboxAccessForUser(ctx, args.sandboxId, user._id))
  },
})

export const sandboxAccess = query({
  args: {
    sandboxId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    return await sandboxAccessForUser(ctx, args.sandboxId, user._id)
  },
})

export const streamAccess = query({
  args: {
    runId: v.id("codexRuns"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== user._id) return null

    const [message, checkpoint] = await Promise.all([
      ctx.db.get(run.assistantMessageId),
      codexRunCheckpoint(ctx, args.runId),
    ])
    const runLogs = compactRunLogs(checkpoint?.logs ?? run.logs)
    const messageLogs = compactRunLogs(message?.meta?.logs)

    return {
      checkpointContent: checkpoint?.content ?? run.content ?? "",
      lastStreamId: checkpoint?.lastStreamId,
      logs: runLogs.length ? runLogs : messageLogs,
      runId: run._id,
      status: run.status,
      threadId: run.threadId,
    }
  },
})

export const liveCheckpointForRun = query({
  args: {
    runId: v.id("codexRuns"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== user._id) return null

    const [message, checkpoint] = await Promise.all([
      ctx.db.get(run.assistantMessageId),
      codexRunCheckpoint(ctx, args.runId),
    ])
    const runLogs = compactRunLogs(checkpoint?.logs ?? run.logs)
    const messageLogs = compactRunLogs(message?.meta?.logs)

    return {
      content: checkpoint?.content ?? run.content ?? message?.content ?? "",
      lastStreamId: checkpoint?.lastStreamId,
      logs: runLogs.length ? runLogs : messageLogs,
      runId: run._id,
      status: run.status,
    }
  },
})

export const create = mutation({
  args: {
    assistantMessageId: v.id("messages"),
    baseBranch: v.optional(v.string()),
    branchMode: v.optional(branchMode),
    branchName: v.optional(v.string()),
    codexThreadId: v.optional(v.string()),
    githubToken: v.optional(v.string()),
    githubUserEmail: v.optional(v.string()),
    githubUserName: v.optional(v.string()),
    githubUsername: v.optional(v.string()),
    imageAttachments: v.optional(v.array(imageAttachment)),
    model,
    notesAccessToken: v.string(),
    previousDiff: v.optional(v.string()),
    profile: v.optional(v.string()),
    prompt: v.string(),
    reasoningEffort: thinking,
    repoUrl: v.string(),
    resumeContext: v.optional(v.string()),
    sandboxId: v.optional(v.string()),
    sandboxPresetId: v.optional(v.id("sandboxPresets")),
    speed,
    threadId: v.id("threads"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    requireWorkerSecret(args.workerSecret)
    const thread = await requireOwnedThread(ctx, args.threadId, userId)
    if (thread.hasPendingMessage) {
      const activeRun = await activeRunForThread(ctx, args.threadId)
      if (activeRun) {
        return {
          ok: false as const,
          message: "A Codex run is already active.",
          status: "thread_busy" as const,
        }
      }
    }
    await requireOwnedAssistantMessage(
      ctx,
      args.assistantMessageId,
      args.threadId,
      userId
    )
    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      args.sandboxPresetId ?? thread.sandboxPresetId,
      userId
    )
    const { auth, profile: authProfile } = await findCodexAuth(
      ctx,
      userId,
      args.profile,
      {
        fallbackToActive: true,
      }
    )
    if (!auth) {
      return {
        ok: false as const,
        message: codexAuthMissingMessage(authProfile),
        profile: authProfile,
        status: "missing_auth" as const,
      }
    }
    if (auth.invalidatedAt) {
      return {
        ok: false as const,
        message: codexAuthReconnectMessage(authProfile),
        profile: authProfile,
        status: "auth_reconnect_required" as const,
      }
    }
    const now = Date.now()
    const queuedLog = {
      kind: "setup" as const,
      message: "Queued Codex run",
      time: now,
    }
    const runId = await ctx.db.insert("codexRuns", {
      assistantMessageId: args.assistantMessageId,
      ...(args.baseBranch ? { baseBranch: args.baseBranch } : {}),
      ...(args.branchMode ? { branchMode: args.branchMode } : {}),
      ...(args.branchName ? { branchName: args.branchName } : {}),
      ...(args.codexThreadId ? { codexThreadId: args.codexThreadId } : {}),
      createdAt: now,
      ...(args.githubUserEmail
        ? { githubUserEmail: args.githubUserEmail }
        : {}),
      ...(args.githubUserName ? { githubUserName: args.githubUserName } : {}),
      ...(args.githubUsername ? { githubUsername: args.githubUsername } : {}),
      model: args.model,
      profile: auth.profile,
      reasoningEffort: args.reasoningEffort,
      repoUrl: args.repoUrl,
      ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
      sandboxPresetId,
      ...(args.sandboxId ? { sandboxState: "running" as const } : {}),
      speed: args.speed,
      status: "queued",
      threadId: args.threadId,
      updatedAt: now,
      userId,
    })

    await Promise.all([
      ctx.db.insert("codexRunInputs", {
        ...(args.githubToken ? { githubToken: args.githubToken } : {}),
        ...(args.imageAttachments?.length
          ? { imageAttachments: args.imageAttachments }
          : {}),
        notesAccessToken: args.notesAccessToken,
        ...(args.previousDiff ? { previousDiff: args.previousDiff } : {}),
        prompt: args.prompt,
        ...(args.resumeContext ? { resumeContext: args.resumeContext } : {}),
        runId,
        userId,
      }),
      upsertCodexRunCheckpoint(
        ctx,
        {
          _id: runId,
          threadId: args.threadId,
          userId,
        },
        { content: "", logs: [queuedLog] }
      ),
    ])

    await ctx.db.patch(args.threadId, {
      hasPendingMessage: true,
      ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
      ...(args.sandboxId ? { sandboxState: "running" as const } : {}),
      updatedAt: now,
    })

    return { ok: true as const, runId, userId }
  },
})

export const attachTriggerRun = mutation({
  args: {
    runId: v.id("codexRuns"),
    triggerRunId: v.string(),
  },
  handler: async (ctx, args) => {
    const [userId, run] = await Promise.all([
      ensureCurrentUser(ctx),
      ctx.db.get(args.runId),
    ])
    if (!run || run.userId !== userId) throw new Error("Run not found.")

    await ctx.db.patch(args.runId, {
      triggerRunId: args.triggerRunId,
      updatedAt: Date.now(),
    })

    return { canceled: run.status === "canceled" || run.status === "canceling" }
  },
})

const finalizeCancelArgs = {
  runId: v.id("codexRuns"),
  sandboxId: v.optional(v.string()),
  sandboxState: v.optional(sandboxState),
  triggerRunId: v.string(),
}

async function finalizeCancelForTriggerRun(
  ctx: MutationCtx,
  args: {
    runId: Id<"codexRuns">
    sandboxId?: string
    sandboxState?: Infer<typeof sandboxState>
    triggerRunId: string
  },
  options: { allowStarted: boolean }
) {
  const [userId, run] = await Promise.all([
    ensureCurrentUser(ctx),
    ctx.db.get(args.runId),
  ])
  if (!run || run.userId !== userId) throw new Error("Run not found.")
  if (run.triggerRunId !== args.triggerRunId) return { canceled: false }
  if (run.status === "canceled") {
    if (args.sandboxId && run.sandboxId !== args.sandboxId) {
      const now = Date.now()
      await Promise.all([
        ctx.db.patch(run._id, {
          sandboxId: args.sandboxId,
          ...(args.sandboxState ? { sandboxState: args.sandboxState } : {}),
          updatedAt: now,
        }),
        ctx.db.patch(run.threadId, {
          sandboxId: args.sandboxId,
          ...(args.sandboxState ? { sandboxState: args.sandboxState } : {}),
          updatedAt: now,
        }),
      ])
    }
    return { canceled: true }
  }
  if (run.status !== "canceling") return { canceled: false }
  if (run.startedAt && !options.allowStarted) return { canceled: false }

  await markRunCanceled(
    ctx,
    {
      ...run,
      ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
      ...(args.sandboxState ? { sandboxState: args.sandboxState } : {}),
    },
    "_Stopped._",
    args.sandboxId
  )
  return { canceled: true }
}

export const finishQueuedCancel = mutation({
  args: finalizeCancelArgs,
  handler: async (ctx, args) =>
    finalizeCancelForTriggerRun(ctx, args, { allowStarted: false }),
})

// For a "canceling" run whose Trigger run is already terminal (canceled while
// queued, crashed, or finished before observing the cancel): no worker exists
// anymore to call workerCancel, so the cancel endpoint finalizes directly.
// Safe to race a live worker — worker mutations no-op once the run is
// canceled.
export const finishDeadTriggerCancel = mutation({
  args: finalizeCancelArgs,
  handler: async (ctx, args) =>
    finalizeCancelForTriggerRun(ctx, args, { allowStarted: true }),
})

export const syncRunSandbox = mutation({
  args: {
    runId: v.id("codexRuns"),
    sandboxId: v.string(),
    sandboxState,
  },
  handler: async (ctx, args) => {
    const [userId, run] = await Promise.all([
      ensureCurrentUser(ctx),
      ctx.db.get(args.runId),
    ])
    if (!run || run.userId !== userId) throw new Error("Run not found.")

    const now = Date.now()
    await Promise.all([
      ctx.db.patch(run._id, {
        sandboxId: args.sandboxId,
        sandboxState: args.sandboxState,
        updatedAt: now,
      }),
      ctx.db.patch(run.threadId, {
        sandboxId: args.sandboxId,
        sandboxState: args.sandboxState,
        updatedAt: now,
      }),
    ])

    return { synced: true }
  },
})

export const failBeforeStart = mutation({
  args: {
    error: v.string(),
    runId: v.id("codexRuns"),
  },
  handler: async (ctx, args) => {
    const [userId, run] = await Promise.all([
      ensureCurrentUser(ctx),
      ctx.db.get(args.runId),
    ])
    if (!run || run.userId !== userId) throw new Error("Run not found.")
    if (TERMINAL_RUN_STATUSES.has(run.status)) return
    if (run.status === "canceling") {
      await markRunCanceled(ctx, run)
      return
    }

    const now = Date.now()
    await Promise.all([
      ctx.db.patch(args.runId, {
        content: args.error,
        error: args.error,
        finishedAt: now,
        status: "failed",
        updatedAt: now,
      }),
      ctx.db.patch(run.assistantMessageId, {
        content: args.error,
        error: true,
        pending: false,
      }),
      ctx.db.patch(run.threadId, {
        hasPendingMessage: false,
        updatedAt: now,
      }),
    ])
  },
})

export const cancelActiveForThread = mutation({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const [, run] = await Promise.all([
      requireOwnedThread(ctx, args.threadId, userId),
      activeRunForThread(ctx, args.threadId),
    ])
    if (!run) return null

    const canceled = await markRunCanceling(ctx, run)

    return {
      runId: run._id,
      sandboxId: canceled.sandboxId,
      triggerRunId: run.triggerRunId,
    }
  },
})

export const workerStartAndGetInput = mutation({
  args: {
    runId: v.id("codexRuns"),
    triggerRunId: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error("Run not found.")
    if (run.status === "canceled") return { canceled: true as const }
    if (run.status === "canceling") {
      if (!run.triggerRunId) {
        await ctx.db.patch(args.runId, {
          triggerRunId: args.triggerRunId,
          updatedAt: Date.now(),
        })
      }
      await markRunCanceled(ctx, {
        ...run,
        triggerRunId: run.triggerRunId ?? args.triggerRunId,
      })
      return { canceled: true as const }
    }
    if (run.status !== "queued") {
      return { canceled: true as const }
    }
    if (run.triggerRunId && run.triggerRunId !== args.triggerRunId) {
      return { canceled: true as const }
    }

    const now = Date.now()
    await Promise.all([
      ctx.db.patch(args.runId, {
        startedAt: run.startedAt ?? now,
        status: "running",
        triggerRunId: run.triggerRunId ?? args.triggerRunId,
        updatedAt: now,
      }),
      ctx.db.patch(run.threadId, {
        hasPendingMessage: true,
        updatedAt: now,
      }),
    ])

    const updatedRun = await ctx.db.get(args.runId)
    if (!updatedRun) throw new Error("Run not found.")

    return await workerInputForRun(ctx, updatedRun)
  },
})

export const workerAppendLogs = mutation({
  args: {
    logs: v.array(runLog),
    runId: v.id("codexRuns"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    if (args.logs.length === 0) return { canceled: false }

    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error("Run not found.")

    const sandboxId = args.logs.map(sandboxIdFromLog).find(Boolean)
    const checkpoint = await codexRunCheckpoint(ctx, args.runId)
    if (run.status === "canceled" || run.status === "canceling") {
      const now = Date.now()
      await Promise.all([
        upsertCodexRunCheckpoint(ctx, run, {
          logs: compactRunLogs([
            ...(checkpoint?.logs ?? run.logs ?? []),
            ...args.logs,
          ]),
        }),
        sandboxId
          ? ctx.db.patch(args.runId, {
              sandboxId,
              sandboxState: run.sandboxState ?? "running",
              updatedAt: now,
            })
          : Promise.resolve(),
      ])
      if (sandboxId) {
        await ctx.db.patch(run.threadId, {
          sandboxId,
          sandboxState: run.sandboxState ?? "running",
          updatedAt: now,
        })
      }
      return { canceled: true }
    }

    const nextLogs = compactRunLogs([
      ...(checkpoint?.logs ?? run.logs ?? []),
      ...args.logs,
    ])
    const now = Date.now()
    await Promise.all([
      upsertCodexRunCheckpoint(ctx, run, { logs: nextLogs }),
      sandboxId
        ? ctx.db.patch(args.runId, {
            sandboxId,
            sandboxState: "running" as const,
            updatedAt: now,
          })
        : Promise.resolve(),
    ])

    if (sandboxId) {
      await ctx.db.patch(run.threadId, {
        sandboxId,
        sandboxState: "running",
        updatedAt: now,
      })
    }

    return { canceled: false }
  },
})

export const workerUpdateContent = mutation({
  args: {
    content: v.string(),
    lastStreamId: v.optional(v.string()),
    runId: v.id("codexRuns"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error("Run not found.")
    if (run.status === "canceled" || run.status === "canceling") {
      return { canceled: true }
    }

    await upsertCodexRunCheckpoint(ctx, run, {
      content: args.content,
      lastStreamId: args.lastStreamId,
    })

    return { canceled: false }
  },
})

export const workerComplete = mutation({
  args: {
    branchName: v.optional(v.string()),
    codexThreadId: v.optional(v.string()),
    content: v.string(),
    diff: v.optional(v.string()),
    exitCode: v.number(),
    runId: v.id("codexRuns"),
    sandboxId: v.optional(v.string()),
    statusText: v.optional(v.string()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error("Run not found.")
    if (run.status === "canceled") return { canceled: true }
    if (run.status === "canceling") {
      await markRunCanceled(ctx, run, "_Stopped._", args.sandboxId)
      return { canceled: true }
    }

    const now = Date.now()
    const nextStatus = args.exitCode === 0 ? "succeeded" : "failed"
    const checkpoint = await codexRunCheckpoint(ctx, args.runId)
    const runLogs = compactRunLogs(checkpoint?.logs ?? run.logs)
    await Promise.all([
      ctx.db.patch(args.runId, {
        ...(args.branchName ? { branchName: args.branchName } : {}),
        ...(args.codexThreadId ? { codexThreadId: args.codexThreadId } : {}),
        ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
        ...(args.sandboxId ? { sandboxState: "running" as const } : {}),
        finishedAt: now,
        status: nextStatus,
        updatedAt: now,
      }),
      upsertCodexRunCheckpoint(ctx, run, { content: args.content }),
    ])

    const message = await ctx.db.get(run.assistantMessageId)
    if (
      message &&
      message.threadId === run.threadId &&
      message.userId === run.userId &&
      message.role === "assistant"
    ) {
      const existingMeta = compactMessageMeta(message.meta)
      const logs = runLogs.length ? runLogs : existingMeta?.logs
      await ctx.db.patch(message._id, {
        content: args.content,
        meta:
          existingMeta ||
          logs?.length ||
          args.branchName ||
          args.diff ||
          args.statusText
            ? {
                ...existingMeta,
                ...(args.branchName ? { branch: args.branchName } : {}),
                ...(args.diff ? { diff: args.diff } : {}),
                ...(logs?.length ? { logs } : {}),
                ...(args.statusText ? { status: args.statusText } : {}),
              }
            : undefined,
        pending: false,
      })
    }

    await ctx.db.patch(run.threadId, {
      ...(args.codexThreadId ? { codexThreadId: args.codexThreadId } : {}),
      hasPendingMessage: false,
      ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
      ...(args.sandboxId ? { sandboxState: "running" as const } : {}),
      updatedAt: now,
    })

    return { canceled: false }
  },
})

export const workerFail = mutation({
  args: {
    error: v.string(),
    runId: v.id("codexRuns"),
    sandboxId: v.optional(v.string()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error("Run not found.")
    if (run.status === "canceled") return { canceled: true }
    if (run.status === "canceling") {
      await markRunCanceled(ctx, run, "_Stopped._", args.sandboxId)
      return { canceled: true }
    }

    const now = Date.now()
    const checkpoint = await codexRunCheckpoint(ctx, args.runId)
    const runLogs = compactRunLogs(checkpoint?.logs ?? run.logs)
    await Promise.all([
      ctx.db.patch(args.runId, {
        error: args.error,
        finishedAt: now,
        ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
        ...(args.sandboxId ? { sandboxState: "running" as const } : {}),
        status: "failed",
        updatedAt: now,
      }),
      upsertCodexRunCheckpoint(ctx, run, { content: args.error }),
      ctx.db.patch(run.assistantMessageId, {
        content: args.error,
        error: true,
        meta: runLogs.length ? { logs: runLogs } : undefined,
        pending: false,
      }),
      ctx.db.patch(run.threadId, {
        hasPendingMessage: false,
        ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
        ...(args.sandboxId ? { sandboxState: "running" as const } : {}),
        updatedAt: now,
      }),
    ])

    return { canceled: false }
  },
})

export const workerCancel = mutation({
  args: {
    runId: v.id("codexRuns"),
    sandboxId: v.optional(v.string()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const run = await ctx.db.get(args.runId)
    if (!run) return
    await markRunCanceled(ctx, run, "_Stopped._", args.sandboxId)
  },
})
