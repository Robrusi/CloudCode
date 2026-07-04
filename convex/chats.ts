import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import { compactMessageMeta } from "./lib/codexRunLogs"
import {
  branchMode,
  imageAttachment,
  messageMeta,
  model,
  speed,
  thinking,
  threadSandboxState as sandboxState,
} from "./lib/codexRunValidators"
import { latestSandboxIdForRun } from "./lib/codexRunLifecycle"
import { resolveOwnedPresetOrAutoDefault } from "./lib/sandboxPresets"
import { requireOwnedThread } from "./lib/threadAccess"
import {
  MAX_NOTES_LENGTH,
  appendNotes,
  normalizeNotes,
  notesResponse,
  notesRevision,
  patchNotesValue,
  requireRunThreadNotesAccess,
  setTodoStatus,
  todoLine,
} from "./lib/threadNotes"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"

const THREAD_LIST_LIMIT = 80

function uniqueSandboxIds(ids: Array<string | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))]
}

function sandboxIdsForThreadRuns(
  thread: Pick<Doc<"threads">, "sandboxId">,
  runs: Array<Pick<Doc<"codexRuns">, "logs" | "sandboxId">>
) {
  return uniqueSandboxIds([
    thread.sandboxId,
    ...runs.map((run) => latestSandboxIdForRun(run)),
  ])
}

async function threadRuns(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">
) {
  return await ctx.db
    .query("codexRuns")
    .withIndex("by_thread_updated", (q) => q.eq("threadId", threadId))
    .collect()
}

/**
 * An automation keeps a live "current chat" in `threadId`. When the user
 * deletes that chat we must NOT delete the automation — instead we move it to a
 * fresh empty shell thread so the schedule keeps firing and posts into a new
 * chat on its next run. Only the automation's current chat is repointed; older
 * per-run chats keep their back-link for provenance and are left untouched.
 */
async function relinkAutomationsOffThread(
  ctx: MutationCtx,
  thread: Pick<Doc<"threads">, "_id" | "userId">
) {
  const automations = await ctx.db
    .query("automations")
    .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
    .collect()

  const now = Date.now()
  await Promise.all(
    automations
      .filter((automation) => automation.userId === thread.userId)
      .map(async (automation) => {
        const replacementThreadId = await ctx.db.insert("threads", {
          automationId: automation._id,
          ...(automation.baseBranch
            ? { baseBranch: automation.baseBranch }
            : {}),
          ...(automation.branchMode
            ? { branchMode: automation.branchMode }
            : {}),
          createdAt: now,
          model: automation.model,
          repoUrl: automation.repoUrl,
          ...(automation.sandboxPresetId
            ? { sandboxPresetId: automation.sandboxPresetId }
            : {}),
          title: automation.name,
          updatedAt: now,
          userId: automation.userId,
        })
        await ctx.db.patch(automation._id, {
          threadId: replacementThreadId,
          updatedAt: now,
        })
      })
  )
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
    automationId: thread.automationId,
    reviewId: thread.reviewId,
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
    notes: thread.notes,
    messages: messages.map((message) => ({
      attachments: message.attachments,
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

    // Automation threads only join the sidebar feed once a run has posted to
    // them; before that they are empty shells managed from Automations.
    // Automation/review threads are tagged so the client can keep them in
    // their own sidebar contexts, never among normal chats.
    const visible = threads.filter(
      (thread) => !thread.automationId || thread.lastUserMessageAt
    )

    return await Promise.all(
      visible.map((thread) => threadSummaryRecord(ctx, thread))
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

export const threadSandboxIds = query({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) throw new Error("Not authenticated.")

    const thread = await requireOwnedThread(ctx, args.threadId, user._id)
    const runs = await threadRuns(ctx, args.threadId)

    return {
      sandboxIds: sandboxIdsForThreadRuns(thread, runs),
    }
  },
})

export const createThread = mutation({
  args: {
    attachments: v.optional(v.array(imageAttachment)),
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
      hasPendingMessage: true,
      lastUserMessageAt: now,
      model: args.model,
      repoUrl: args.repoUrl,
      sandboxPresetId,
      title: args.title,
      updatedAt: now,
      userId,
    })

    await ctx.db.insert("messages", {
      ...(args.attachments?.length ? { attachments: args.attachments } : {}),
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
    attachments: v.optional(v.array(imageAttachment)),
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
          ...(args.attachments?.length
            ? { attachments: args.attachments }
            : {}),
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

export const setThreadNotes = mutation({
  args: {
    notes: v.string(),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedThread(ctx, args.threadId, userId)

    const notes = args.notes.slice(0, MAX_NOTES_LENGTH)

    await ctx.db.patch(args.threadId, {
      notes: notes.length > 0 ? notes : undefined,
      updatedAt: Date.now(),
    })
  },
})

export const workerGetThreadNotes = query({
  args: {
    notesAccessToken: v.string(),
    runId: v.id("codexRuns"),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const thread = await requireRunThreadNotesAccess(ctx, args)
    return notesResponse(thread)
  },
})

export const workerReplaceThreadNotes = mutation({
  args: {
    expectedRevision: v.optional(v.string()),
    notes: v.string(),
    notesAccessToken: v.string(),
    runId: v.id("codexRuns"),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const thread = await requireRunThreadNotesAccess(ctx, args)
    const current = thread.notes ?? ""
    const currentRevision = notesRevision(current)

    if (args.expectedRevision && args.expectedRevision !== currentRevision) {
      throw new Error(
        "Shared notes changed after the last read. Read notes again before replacing them."
      )
    }

    const notes = normalizeNotes(args.notes)
    await ctx.db.patch(args.threadId, {
      notes: patchNotesValue(notes),
      updatedAt: Date.now(),
    })

    return notesResponse({ ...thread, notes })
  },
})

export const workerAppendThreadNotes = mutation({
  args: {
    notesAccessToken: v.string(),
    runId: v.id("codexRuns"),
    text: v.string(),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const thread = await requireRunThreadNotesAccess(ctx, args)
    const notes = appendNotes(thread.notes ?? "", args.text)

    await ctx.db.patch(args.threadId, {
      notes: patchNotesValue(notes),
      updatedAt: Date.now(),
    })

    return notesResponse({ ...thread, notes })
  },
})

export const workerAddThreadTodo = mutation({
  args: {
    checked: v.optional(v.boolean()),
    notesAccessToken: v.string(),
    runId: v.id("codexRuns"),
    text: v.string(),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const thread = await requireRunThreadNotesAccess(ctx, args)
    const item = todoLine(args.text, Boolean(args.checked))
    const notes = appendNotes(thread.notes ?? "", item)

    await ctx.db.patch(args.threadId, {
      notes: patchNotesValue(notes),
      updatedAt: Date.now(),
    })

    return notesResponse({ ...thread, notes })
  },
})

export const workerSetThreadTodoStatus = mutation({
  args: {
    checked: v.boolean(),
    notesAccessToken: v.string(),
    occurrence: v.optional(v.number()),
    runId: v.id("codexRuns"),
    text: v.string(),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const thread = await requireRunThreadNotesAccess(ctx, args)
    const result = setTodoStatus(
      thread.notes ?? "",
      args.text,
      args.checked,
      args.occurrence ?? 1
    )

    if (result.updated) {
      await ctx.db.patch(args.threadId, {
        notes: patchNotesValue(result.notes),
        updatedAt: Date.now(),
      })
    }

    return {
      ...notesResponse({ ...thread, notes: result.notes }),
      updated: result.updated,
    }
  },
})

export const deleteThread = mutation({
  args: {
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const thread = await ctx.db.get(args.threadId)
    // Idempotent delete: a thread that is already gone is a success, not an
    // error. This lets the client safely retry a delete whose response was
    // lost in transit without surfacing a spurious "Thread not found." failure.
    if (!thread) {
      return { sandboxIds: [] as string[] }
    }
    if (thread.userId !== userId) {
      throw new Error("Thread not found.")
    }
    const [messages, runs] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
        .collect(),
      threadRuns(ctx, args.threadId),
    ])
    const [runInputs, runCheckpoints, runLogCheckpoints] = await Promise.all([
      Promise.all(
        runs.map((run) =>
          ctx.db
            .query("codexRunInputs")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .unique()
        )
      ),
      Promise.all(
        runs.map((run) =>
          ctx.db
            .query("codexRunCheckpoints")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .unique()
        )
      ),
      Promise.all(
        runs.map((run) =>
          ctx.db
            .query("codexRunLogCheckpoints")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .unique()
        )
      ),
    ])
    const sandboxIds = sandboxIdsForThreadRuns(thread, runs)
    // Deleting an automation's current chat must not delete the automation:
    // move any such automation onto a fresh shell thread first so its schedule
    // survives and keeps posting into a new chat.
    await relinkAutomationsOffThread(ctx, thread)

    await Promise.all([
      ...runs.map((run) => ctx.db.delete(run._id)),
      ...runInputs.flatMap((row) => (row ? [ctx.db.delete(row._id)] : [])),
      ...runCheckpoints.flatMap((row) => (row ? [ctx.db.delete(row._id)] : [])),
      ...runLogCheckpoints.flatMap((row) =>
        row ? [ctx.db.delete(row._id)] : []
      ),
      ...messages.map((message) => ctx.db.delete(message._id)),
    ])
    await ctx.db.delete(args.threadId)

    return { sandboxIds }
  },
})
