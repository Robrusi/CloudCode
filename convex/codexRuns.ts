import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"

const model = v.union(
  v.literal("gpt-5.5"),
  v.literal("gpt-5.4"),
  v.literal("gpt-5.4-mini")
)
const speed = v.union(v.literal("standard"), v.literal("fast"))
const branchMode = v.union(
  v.literal("auto"),
  v.literal("custom"),
  v.literal("base")
)
const thinking = v.union(
  v.literal("none"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("xhigh")
)
const sandboxState = v.union(
  v.literal("running"),
  v.literal("stopped"),
  v.literal("deleted"),
  v.literal("error")
)
const runLog = v.object({
  detail: v.optional(v.string()),
  kind: v.union(
    v.literal("setup"),
    v.literal("command"),
    v.literal("reasoning"),
    v.literal("stdout"),
    v.literal("stderr"),
    v.literal("result")
  ),
  message: v.string(),
  time: v.number(),
})
const MAX_STORED_RUN_LOGS = 80
const MAX_STORED_LOG_MESSAGE_LENGTH = 500
const MAX_STORED_LOG_DETAIL_LENGTH = 1_500
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "canceled"])
const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "canceling"])
const STORED_LOG_KINDS = new Set<string>([
  "setup",
  "command",
  "result",
  "stderr",
] as const)

type StoredRunLog = {
  detail?: string
  kind: "setup" | "command" | "reasoning" | "stdout" | "stderr" | "result"
  message: string
  time: number
}

async function sandboxAccessForUser(
  ctx: QueryCtx,
  sandboxId: string,
  userId: Id<"users">
) {
  const runs = await ctx.db
    .query("codexRuns")
    .withIndex("by_sandbox", (q) => q.eq("sandboxId", sandboxId))
    .take(10)
  const run = runs.find((candidate) => candidate.userId === userId)
  if (run) return { repoUrl: run.repoUrl }

  const threads = await ctx.db
    .query("threads")
    .withIndex("by_sandbox", (q) => q.eq("sandboxId", sandboxId))
    .take(10)
  const thread = threads.find((candidate) => candidate.userId === userId)
  if (thread) return { repoUrl: thread.repoUrl }

  return null
}

function truncate(value: string | undefined, max: number) {
  if (!value) return undefined
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function compactRunLog(log: StoredRunLog) {
  if (!STORED_LOG_KINDS.has(log.kind)) return null
  return {
    ...(truncate(log.detail, MAX_STORED_LOG_DETAIL_LENGTH)
      ? { detail: truncate(log.detail, MAX_STORED_LOG_DETAIL_LENGTH) }
      : {}),
    kind: log.kind,
    message: truncate(log.message, MAX_STORED_LOG_MESSAGE_LENGTH) ?? "",
    time: log.time,
  }
}

function compactRunLogs(logs: StoredRunLog[] | undefined) {
  return (logs ?? [])
    .flatMap((log) => {
      const compacted = compactRunLog(log)
      return compacted ? [compacted] : []
    })
    .slice(-MAX_STORED_RUN_LOGS)
}

function compactMessageMeta(
  meta: Doc<"messages">["meta"]
): Doc<"messages">["meta"] {
  if (!meta) return undefined
  const logs = compactRunLogs(meta.logs)
  const { logs: _logs, ...rest } = meta
  void _logs
  return {
    ...rest,
    ...(logs.length ? { logs } : {}),
  }
}

async function requireOwnedThread(
  ctx: MutationCtx,
  threadId: Id<"threads">,
  userId: Id<"users">
) {
  const thread = await ctx.db.get(threadId)

  if (!thread || thread.userId !== userId) {
    throw new Error("Thread not found.")
  }

  return thread
}

async function requireOwnedAssistantMessage(
  ctx: MutationCtx | QueryCtx,
  messageId: Id<"messages">,
  threadId: Id<"threads">,
  userId: Id<"users">
) {
  const message = await ctx.db.get(messageId)

  if (
    !message ||
    message.threadId !== threadId ||
    message.userId !== userId ||
    message.role !== "assistant"
  ) {
    throw new Error("Message not found.")
  }

  return message
}

async function requireOwnedPreset(
  ctx: MutationCtx,
  presetId: Id<"sandboxPresets"> | undefined,
  userId: Id<"users">
) {
  if (!presetId) return undefined

  const preset = await ctx.db.get(presetId)
  if (!preset || preset.userId !== userId) {
    throw new Error("Preset not found.")
  }

  return preset._id
}

async function activeRunForThread(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">
) {
  const runs = await ctx.db
    .query("codexRuns")
    .withIndex("by_thread_updated", (q) => q.eq("threadId", threadId))
    .order("desc")
    .take(12)

  return runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status))
}

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

function sandboxIdFromLog(log: StoredRunLog) {
  if (log.kind !== "setup" || !log.detail) {
    return undefined
  }

  return log.message === "Daytona sandbox ready" ||
    log.message === "Recovered with a fresh Daytona sandbox" ||
    log.message === "Using prepared auto environment sandbox"
    ? log.detail
    : undefined
}

function latestSandboxIdForRun(
  run: Pick<Doc<"codexRuns">, "logs" | "sandboxId">
) {
  if (run.sandboxId) return run.sandboxId

  for (let index = (run.logs?.length ?? 0) - 1; index >= 0; index -= 1) {
    const sandboxId = sandboxIdFromLog(run.logs![index])
    if (sandboxId) return sandboxId
  }

  return undefined
}

async function markRunCanceled(
  ctx: MutationCtx,
  run: Doc<"codexRuns">,
  content = "_Stopped._",
  sandboxIdOverride?: string
) {
  const now = Date.now()
  const sandboxId = sandboxIdOverride ?? latestSandboxIdForRun(run)
  const sandboxState =
    run.sandboxState ?? (sandboxId ? ("running" as const) : undefined)
  const canceledContent = run.content?.trim()
    ? `${run.content.trimEnd()}\n\n${content}`
    : content

  const sandboxPatch = {
    ...(sandboxId ? { sandboxId } : {}),
    ...(sandboxState ? { sandboxState } : {}),
  }

  if (!TERMINAL_RUN_STATUSES.has(run.status)) {
    await ctx.db.patch(run._id, {
      content: canceledContent,
      finishedAt: now,
      ...sandboxPatch,
      status: "canceled",
      updatedAt: now,
    })
  } else if (sandboxId && run.sandboxId !== sandboxId) {
    await ctx.db.patch(run._id, {
      ...sandboxPatch,
      updatedAt: now,
    })
  }

  const message = await ctx.db.get(run.assistantMessageId)
  if (
    message &&
    message.threadId === run.threadId &&
    message.userId === run.userId &&
    message.role === "assistant" &&
    message.pending
  ) {
    const existingMeta = compactMessageMeta(message.meta)
    const runLogs = compactRunLogs(run.logs)
    await ctx.db.patch(message._id, {
      content: canceledContent,
      error: false,
      meta:
        existingMeta || runLogs.length
          ? {
              ...existingMeta,
              ...(runLogs.length ? { logs: runLogs } : {}),
            }
          : undefined,
      pending: false,
    })
  }

  await ctx.db.patch(run.threadId, {
    hasPendingMessage: false,
    ...sandboxPatch,
    updatedAt: now,
  })

  return {
    sandboxId,
    sandboxState,
  }
}

async function markRunCanceling(ctx: MutationCtx, run: Doc<"codexRuns">) {
  const now = Date.now()
  const sandboxId = latestSandboxIdForRun(run)
  const sandboxState =
    run.sandboxState ?? (sandboxId ? ("running" as const) : undefined)

  await Promise.all([
    ctx.db.patch(run._id, {
      ...(sandboxId ? { sandboxId } : {}),
      ...(sandboxState ? { sandboxState } : {}),
      status: "canceling",
      updatedAt: now,
    }),
    ctx.db.patch(run.threadId, {
      hasPendingMessage: true,
      ...(sandboxId ? { sandboxId } : {}),
      ...(sandboxState ? { sandboxState } : {}),
      updatedAt: now,
    }),
  ])

  return {
    sandboxId,
    sandboxState,
  }
}

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
      if (activeRun) throw new Error("A Codex run is already active.")
    }
    await requireOwnedAssistantMessage(
      ctx,
      args.assistantMessageId,
      args.threadId,
      userId
    )
    const sandboxPresetId = await requireOwnedPreset(
      ctx,
      args.sandboxPresetId,
      userId
    )
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
      content: "",
      createdAt: now,
      ...(args.githubToken ? { githubToken: args.githubToken } : {}),
      ...(args.githubUserEmail
        ? { githubUserEmail: args.githubUserEmail }
        : {}),
      ...(args.githubUserName ? { githubUserName: args.githubUserName } : {}),
      ...(args.githubUsername ? { githubUsername: args.githubUsername } : {}),
      logs: [queuedLog],
      model: args.model,
      notesAccessToken: args.notesAccessToken,
      ...(args.previousDiff ? { previousDiff: args.previousDiff } : {}),
      ...(args.profile ? { profile: args.profile } : {}),
      prompt: args.prompt,
      reasoningEffort: args.reasoningEffort,
      repoUrl: args.repoUrl,
      ...(args.resumeContext ? { resumeContext: args.resumeContext } : {}),
      ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
      ...(sandboxPresetId ? { sandboxPresetId } : {}),
      ...(args.sandboxId ? { sandboxState: "running" as const } : {}),
      speed: args.speed,
      status: "queued",
      threadId: args.threadId,
      updatedAt: now,
      userId,
    })

    await ctx.db.patch(args.threadId, {
      hasPendingMessage: true,
      ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
      ...(args.sandboxId ? { sandboxState: "running" as const } : {}),
      updatedAt: now,
    })

    return { runId, userId }
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

export const finishQueuedCancel = mutation({
  args: {
    runId: v.id("codexRuns"),
    sandboxId: v.optional(v.string()),
    sandboxState: v.optional(sandboxState),
    triggerRunId: v.string(),
  },
  handler: async (ctx, args) => {
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
    if (run.status !== "canceling" || run.startedAt) {
      return { canceled: false }
    }

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
  },
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

async function workerInputForRun(
  ctx: MutationCtx | QueryCtx,
  run: Doc<"codexRuns">
) {
  const auth = await ctx.db
    .query("codexAuth")
    .withIndex("by_user_profile", (q) =>
      q.eq("userId", run.userId).eq("profile", run.profile ?? "default")
    )
    .unique()

  if (!auth) {
    throw new Error(
      `No Codex ChatGPT OAuth credentials are stored for profile "${run.profile ?? "default"}".`
    )
  }

  let sandboxPreset:
    | {
        daytonaSnapshot?: string
        environmentSlug?: string
        id: Id<"sandboxPresets">
        installScript?: string
        mode?: "manual" | "auto"
        name: string
        pathInstallScript?: string
        secrets: Array<{ name: string; value: string }>
      }
    | undefined
  if (run.sandboxPresetId) {
    const preset = await ctx.db.get(run.sandboxPresetId)
    if (!preset || preset.userId !== run.userId) {
      throw new Error("Preset not found.")
    }
    const secrets = await ctx.db
      .query("sandboxPresetSecrets")
      .withIndex("by_preset", (q) => q.eq("presetId", preset._id))
      .collect()

    sandboxPreset = {
      daytonaSnapshot: preset.daytonaSnapshot,
      environmentSlug: preset.environmentSlug,
      id: preset._id,
      installScript: preset.installScript,
      mode: preset.mode ?? "manual",
      name: preset.name,
      pathInstallScript: preset.pathInstallScript,
      secrets: secrets
        .map((secret) => ({
          name: secret.name,
          value: secret.value,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }

  return {
    auth,
    canceled: false as const,
    run,
    sandboxPreset,
  }
}

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
    if (run.status === "canceled" || run.status === "canceling") {
      const now = Date.now()
      await ctx.db.patch(args.runId, {
        logs: compactRunLogs([...(run.logs ?? []), ...args.logs]),
        ...(sandboxId ? { sandboxId } : {}),
        ...(sandboxId ? { sandboxState: run.sandboxState ?? "running" } : {}),
        updatedAt: now,
      })
      if (sandboxId) {
        await ctx.db.patch(run.threadId, {
          sandboxId,
          sandboxState: run.sandboxState ?? "running",
          updatedAt: now,
        })
      }
      return { canceled: true }
    }

    const nextLogs = compactRunLogs([...(run.logs ?? []), ...args.logs])
    const now = Date.now()
    await ctx.db.patch(args.runId, {
      logs: nextLogs,
      ...(sandboxId ? { sandboxId } : {}),
      ...(sandboxId ? { sandboxState: "running" as const } : {}),
      updatedAt: now,
    })

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

    await ctx.db.patch(args.runId, {
      content: args.content,
      updatedAt: Date.now(),
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
    const runLogs = compactRunLogs(run.logs)
    await ctx.db.patch(args.runId, {
      ...(args.branchName ? { branchName: args.branchName } : {}),
      ...(args.codexThreadId ? { codexThreadId: args.codexThreadId } : {}),
      content: args.content,
      ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
      ...(args.sandboxId ? { sandboxState: "running" as const } : {}),
      finishedAt: now,
      status: nextStatus,
      updatedAt: now,
    })

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
    const runLogs = compactRunLogs(run.logs)
    await Promise.all([
      ctx.db.patch(args.runId, {
        content: args.error,
        error: args.error,
        finishedAt: now,
        ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
        ...(args.sandboxId ? { sandboxState: "running" as const } : {}),
        status: "failed",
        updatedAt: now,
      }),
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
