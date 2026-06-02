import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"

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
  v.literal("paused"),
  v.literal("killed"),
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

const messageMeta = v.object({
  branch: v.optional(v.string()),
  diff: v.optional(v.string()),
  logs: v.optional(v.array(runLog)),
  status: v.optional(v.string()),
})

const THREAD_LIST_LIMIT = 80
const MAX_STORED_RUN_LOGS = 80
const MAX_STORED_LOG_MESSAGE_LENGTH = 500
const MAX_STORED_LOG_DETAIL_LENGTH = 1_500
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

async function presetNameForThread(
  ctx: QueryCtx,
  presetId: Id<"sandboxPresets"> | undefined
) {
  if (!presetId) return undefined
  return (await ctx.db.get(presetId))?.name
}

async function threadSummaryRecord(ctx: QueryCtx, thread: Doc<"threads">) {
  return {
    baseBranch: thread.baseBranch,
    branchMode: thread.branchMode,
    codexThreadId: thread.codexThreadId,
    createdAt: thread.createdAt,
    id: thread._id,
    lastUserMessageAt: thread.lastUserMessageAt ?? thread.createdAt,
    messages: [],
    model: thread.model,
    pending: Boolean(thread.hasPendingMessage),
    repoUrl: thread.repoUrl,
    sandboxPresetId: thread.sandboxPresetId,
    sandboxPresetName: await presetNameForThread(ctx, thread.sandboxPresetId),
    sandboxId: thread.sandboxId,
    sandboxState: thread.sandboxState,
    title: thread.title,
    updatedAt: thread.updatedAt,
  }
}

async function fullThreadRecord(ctx: QueryCtx, thread: Doc<"threads">) {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
    .collect()

  return {
    ...(await threadSummaryRecord(ctx, thread)),
    messages: messages.map((message) => ({
      content: message.content,
      createdAt: message._creationTime,
      error: message.error,
      id: message._id,
      meta: compactMessageMeta(message.meta),
      pending: message.pending,
      role: message.role,
      speed: message.speed,
      thinking: message.thinking,
    })),
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []

    const threads = await ctx.db
      .query("threads")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(THREAD_LIST_LIMIT)

    return await Promise.all(
      threads.map((thread) => threadSummaryRecord(ctx, thread))
    )
  },
})

export const get = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    const thread = await ctx.db.get(args.threadId)
    if (!thread || thread.userId !== user._id) return null

    return await fullThreadRecord(ctx, thread)
  },
})

export const createThread = mutation({
  args: {
    baseBranch: v.optional(v.string()),
    branchMode: v.optional(branchMode),
    model,
    prompt: v.string(),
    repoUrl: v.string(),
    sandboxPresetId: v.optional(v.id("sandboxPresets")),
    speed,
    thinking,
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const sandboxPresetId = await requireOwnedPreset(
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
      hasPendingMessage: true,
      lastUserMessageAt: now,
      model: args.model,
      repoUrl: args.repoUrl,
      ...(sandboxPresetId ? { sandboxPresetId } : {}),
      title: args.title,
      updatedAt: now,
      userId,
    })

    await ctx.db.insert("messages", {
      content: args.prompt,
      role: "user",
      threadId,
      userId,
    })

    const assistantMessageId = await ctx.db.insert("messages", {
      content: "",
      pending: true,
      role: "assistant",
      speed: args.speed,
      thinking: args.thinking,
      threadId,
      userId,
    })

    return { assistantMessageId, threadId }
  },
})

export const appendRunMessages = mutation({
  args: {
    prompt: v.string(),
    speed,
    thinking,
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedThread(ctx, args.threadId, userId)
    const now = Date.now()

    const [assistantMessageId] = await Promise.all([
      ctx.db
        .insert("messages", {
          content: args.prompt,
          role: "user",
          threadId: args.threadId,
          userId,
        })
        .then(() =>
          ctx.db.insert("messages", {
            content: "",
            pending: true,
            role: "assistant",
            speed: args.speed,
            thinking: args.thinking,
            threadId: args.threadId,
            userId,
          })
        ),
      ctx.db.patch(args.threadId, {
        hasPendingMessage: true,
        lastUserMessageAt: now,
        updatedAt: now,
      }),
    ])

    return { assistantMessageId }
  },
})

export const completeAssistantMessage = mutation({
  args: {
    content: v.string(),
    error: v.optional(v.boolean()),
    messageId: v.id("messages"),
    meta: v.optional(messageMeta),
    sandboxId: v.optional(v.string()),
    sandboxState: v.optional(sandboxState),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)

    const [, message] = await Promise.all([
      requireOwnedThread(ctx, args.threadId, userId),
      ctx.db.get(args.messageId),
    ])
    if (
      !message ||
      message.threadId !== args.threadId ||
      message.userId !== userId
    ) {
      throw new Error("Message not found.")
    }

    const existingMeta = compactMessageMeta(message.meta)
    const nextMeta =
      existingMeta || args.meta
        ? {
            ...existingMeta,
            ...args.meta,
          }
        : undefined

    await Promise.all([
      ctx.db.patch(args.messageId, {
        content: args.content,
        error: args.error,
        meta: nextMeta,
        pending: false,
      }),
      ctx.db.patch(args.threadId, {
        hasPendingMessage: false,
        ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
        ...(args.sandboxState
          ? { sandboxState: args.sandboxState }
          : args.sandboxId
            ? { sandboxState: "running" as const }
            : {}),
        updatedAt: Date.now(),
      }),
    ])
  },
})

export const saveRunState = mutation({
  args: {
    codexThreadId: v.optional(v.string()),
    sandboxId: v.optional(v.string()),
    sandboxState: v.optional(sandboxState),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const [userId, thread] = await Promise.all([
      ensureCurrentUser(ctx),
      ctx.db.get(args.threadId),
    ])

    if (!thread || thread.userId !== userId) {
      return { saved: false }
    }

    await ctx.db.patch(args.threadId, {
      ...(args.codexThreadId ? { codexThreadId: args.codexThreadId } : {}),
      ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
      ...(args.sandboxState
        ? { sandboxState: args.sandboxState }
        : args.sandboxId
          ? { sandboxState: "running" as const }
          : {}),
      updatedAt: Date.now(),
    })
    return { saved: true }
  },
})

export const clearSandbox = mutation({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedThread(ctx, args.threadId, userId).then(() =>
      ctx.db.patch(args.threadId, {
        sandboxId: undefined,
        sandboxState: "deleted",
        updatedAt: Date.now(),
      })
    )
  },
})

export const updateThread = mutation({
  args: {
    model: v.optional(model),
    repoUrl: v.optional(v.string()),
    threadId: v.id("threads"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedThread(ctx, args.threadId, userId)

    const trimmedTitle = args.title?.trim()

    await ctx.db.patch(args.threadId, {
      ...(args.model ? { model: args.model } : {}),
      ...(args.repoUrl ? { repoUrl: args.repoUrl } : {}),
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
      updatedAt: Date.now(),
    })
  },
})

export const deleteThread = mutation({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    await ensureCurrentUser(ctx).then((userId) =>
      requireOwnedThread(ctx, args.threadId, userId)
        .then(() =>
          Promise.all([
            ctx.db
              .query("messages")
              .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
              .collect(),
            ctx.db
              .query("codexRuns")
              .withIndex("by_thread_updated", (q) =>
                q.eq("threadId", args.threadId)
              )
              .collect(),
          ])
        )
        .then(([messages, runs]) =>
          Promise.all([
            ...runs.map((run) => ctx.db.delete(run._id)),
            ...messages.map((message) => ctx.db.delete(message._id)),
          ])
        )
        .then(() => ctx.db.delete(args.threadId))
    )
  },
})
