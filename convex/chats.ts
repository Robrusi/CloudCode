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
          codexThreadId: thread.codexThreadId,
          createdAt: thread.createdAt,
          id: thread._id,
          messages: messages.map((message) => ({
            content: message.content,
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
          sandboxSnapshotId: thread.sandboxSnapshotId,
          sandboxSnapshotIdsToDelete: thread.sandboxSnapshotIdsToDelete,
          title: thread.title,
          updatedAt: thread.updatedAt,
        }
      })
    )
  },
})

export const createThread = mutation({
  args: {
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
    const threadId = await ctx.db.insert("threads", {
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
    sandboxSnapshotId: v.optional(v.string()),
    sandboxSnapshotIdsToDelete: v.optional(v.array(v.string())),
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

    await ctx.db.patch(args.messageId, {
      content: args.content,
      error: args.error,
      meta: args.meta,
      pending: false,
    })
    await ctx.db.patch(args.threadId, {
      ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
      ...(args.sandboxSnapshotId
        ? { sandboxSnapshotId: args.sandboxSnapshotId }
        : {}),
      ...(args.sandboxSnapshotIdsToDelete
        ? {
            sandboxSnapshotIdsToDelete: [
              ...new Set(args.sandboxSnapshotIdsToDelete),
            ],
          }
        : {}),
      updatedAt: Date.now(),
    })
  },
})

export const saveRunState = mutation({
  args: {
    codexThreadId: v.optional(v.string()),
    sandboxId: v.optional(v.string()),
    sandboxSnapshotId: v.optional(v.string()),
    sandboxSnapshotIdsToDelete: v.optional(v.array(v.string())),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedThread(ctx, args.threadId, userId)

    await ctx.db.patch(args.threadId, {
      ...(args.codexThreadId ? { codexThreadId: args.codexThreadId } : {}),
      ...(args.sandboxId ? { sandboxId: args.sandboxId } : {}),
      ...(args.sandboxSnapshotId
        ? { sandboxSnapshotId: args.sandboxSnapshotId }
        : {}),
      ...(args.sandboxSnapshotIdsToDelete
        ? {
            sandboxSnapshotIdsToDelete: [
              ...new Set(args.sandboxSnapshotIdsToDelete),
            ],
          }
        : {}),
      updatedAt: Date.now(),
    })
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
      updatedAt: Date.now(),
    })
  },
})

export const clearSandboxSnapshot = mutation({
  args: {
    sandboxSnapshotIdsToDelete: v.optional(v.array(v.string())),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedThread(ctx, args.threadId, userId)

    await ctx.db.patch(args.threadId, {
      sandboxSnapshotId: undefined,
      sandboxSnapshotIdsToDelete:
        args.sandboxSnapshotIdsToDelete === undefined
          ? undefined
          : [...new Set(args.sandboxSnapshotIdsToDelete)],
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
