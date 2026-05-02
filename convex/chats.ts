import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { MutationCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"

const model = v.union(v.literal("gpt-5.5"), v.literal("gpt-5.4"))
const speed = v.union(v.literal("standard"), v.literal("fast"))
const thinking = v.union(
  v.literal("none"),
  v.literal("minimal"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("xhigh")
)

const messageMeta = v.object({
  branch: v.optional(v.string()),
  diff: v.optional(v.string()),
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
          createdAt: thread.createdAt,
          id: thread._id,
          messages: messages.map((message) => ({
            content: message.content,
            error: message.error,
            id: message._id,
            meta: message.meta,
            pending: message.pending,
            role: message.role,
          })),
          model: thread.model,
          repoUrl: thread.repoUrl,
          sandboxId: thread.sandboxId,
          speed: thread.speed,
          thinking: thread.thinking,
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
    speed,
    thinking,
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const now = Date.now()
    const threadId = await ctx.db.insert("threads", {
      createdAt: now,
      model: args.model,
      repoUrl: args.repoUrl,
      speed: args.speed,
      thinking: args.thinking,
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
      threadId,
      userId,
    })

    return { assistantMessageId, threadId }
  },
})

export const appendRunMessages = mutation({
  args: {
    prompt: v.string(),
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
      updatedAt: Date.now(),
    })
  },
})

export const updateThread = mutation({
  args: {
    model: v.optional(model),
    repoUrl: v.optional(v.string()),
    speed: v.optional(speed),
    thinking: v.optional(thinking),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedThread(ctx, args.threadId, userId)

    await ctx.db.patch(args.threadId, {
      ...(args.model ? { model: args.model } : {}),
      ...(args.repoUrl ? { repoUrl: args.repoUrl } : {}),
      ...(args.speed ? { speed: args.speed } : {}),
      ...(args.thinking ? { thinking: args.thinking } : {}),
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
