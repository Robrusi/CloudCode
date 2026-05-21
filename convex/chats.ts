import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { MutationCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"

const model = v.union(
  v.literal("gpt-5.5"),
  v.literal("gpt-5.4"),
  v.literal("gpt-5.4-mini")
)
const speed = v.union(v.literal("standard"), v.literal("fast"))
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
  sandboxSnapshotId: v.optional(v.string()),
  status: v.optional(v.string()),
})

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

async function resolveOwnedPresetId(
  ctx: MutationCtx,
  presetId: Id<"sandboxPresets"> | undefined,
  userId: Id<"users">
) {
  if (!presetId) return undefined

  const preset = await ctx.db.get(presetId)
  if (!preset || preset.userId !== userId) return undefined

  return preset._id
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
      .collect()

    return await Promise.all(
      threads.map(async (thread) => {
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .collect()

        return {
          baseBranch: thread.baseBranch,
          codexThreadId: thread.codexThreadId,
          createdAt: thread.createdAt,
          id: thread._id,
          messages: messages.map((message) => ({
            content: message.content,
            createdAt: message._creationTime,
            error: message.error,
            id: message._id,
            meta: message.meta,
            pending: message.pending,
            role: message.role,
            speed: message.speed,
            thinking: message.thinking,
          })),
          model: thread.model,
          repoUrl: thread.repoUrl,
          sandboxPresetId: thread.sandboxPresetId,
          sandboxPresetName: thread.sandboxPresetId
            ? (await ctx.db.get(thread.sandboxPresetId))?.name
            : undefined,
          sandboxId: thread.sandboxId,
          sandboxState: thread.sandboxState,
          title: thread.title,
          updatedAt: thread.updatedAt,
        }
      })
    )
  },
})

export const createThread = mutation({
  args: {
    baseBranch: v.optional(v.string()),
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
    const sandboxPresetId = await resolveOwnedPresetId(
      ctx,
      args.sandboxPresetId,
      userId
    )
    const now = Date.now()
    const trimmedBaseBranch = args.baseBranch?.trim()
    const threadId = await ctx.db.insert("threads", {
      ...(trimmedBaseBranch ? { baseBranch: trimmedBaseBranch } : {}),
      createdAt: now,
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

    await ctx.db.insert("messages", {
      content: args.prompt,
      role: "user",
      threadId: args.threadId,
      userId,
    })

    const assistantMessageId = await ctx.db.insert("messages", {
      content: "",
      pending: true,
      role: "assistant",
      speed: args.speed,
      thinking: args.thinking,
      threadId: args.threadId,
      userId,
    })

    await ctx.db.patch(args.threadId, { updatedAt: now })

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
    await requireOwnedThread(ctx, args.threadId, userId)

    const message = await ctx.db.get(args.messageId)
    if (
      !message ||
      message.threadId !== args.threadId ||
      message.userId !== userId
    ) {
      throw new Error("Message not found.")
    }

    const nextMeta =
      message.meta || args.meta
        ? {
            ...message.meta,
            ...args.meta,
          }
        : undefined

    await ctx.db.patch(args.messageId, {
      content: args.content,
      error: args.error,
      meta: nextMeta,
      pending: false,
    })
    await ctx.db.patch(args.threadId, {
      ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
      ...(args.sandboxState
        ? { sandboxState: args.sandboxState }
        : args.sandboxId
          ? { sandboxState: "running" as const }
          : {}),
      updatedAt: Date.now(),
    })
  },
})

export const appendAssistantLogs = mutation({
  args: {
    logs: v.array(runLog),
    messageId: v.id("messages"),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    if (args.logs.length === 0) return

    const userId = await ensureCurrentUser(ctx)
    await requireOwnedThread(ctx, args.threadId, userId)

    const message = await ctx.db.get(args.messageId)
    if (
      !message ||
      message.threadId !== args.threadId ||
      message.userId !== userId ||
      message.role !== "assistant"
    ) {
      throw new Error("Message not found.")
    }

    await ctx.db.patch(args.messageId, {
      meta: {
        ...message.meta,
        logs: [...(message.meta?.logs ?? []), ...args.logs].slice(-500),
      },
    })
  },
})

export const updateAssistantContent = mutation({
  args: {
    content: v.string(),
    messageId: v.id("messages"),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedThread(ctx, args.threadId, userId)

    const message = await ctx.db.get(args.messageId)
    if (
      !message ||
      message.threadId !== args.threadId ||
      message.userId !== userId ||
      message.role !== "assistant" ||
      !message.pending
    ) {
      throw new Error("Message not found.")
    }

    await ctx.db.patch(args.messageId, {
      content: args.content,
    })
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
    const userId = await ensureCurrentUser(ctx)
    const thread = await ctx.db.get(args.threadId)

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
    await requireOwnedThread(ctx, args.threadId, userId)

    await ctx.db.patch(args.threadId, {
      sandboxId: undefined,
      sandboxState: "deleted",
      updatedAt: Date.now(),
    })
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
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedThread(ctx, args.threadId, userId)

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect()

    for (const message of messages) {
      await ctx.db.delete(message._id)
    }

    await ctx.db.delete(args.threadId)
  },
})
