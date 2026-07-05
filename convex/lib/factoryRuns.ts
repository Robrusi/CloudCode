import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { appendCodexRunLogs, upsertCodexRunCheckpoint } from "./codexRunRecords"

export type FactoryRunCreated = {
  runId: Id<"codexRuns">
  threadId: Id<"threads">
  userId: Id<"users">
}

export type FactoryRunInsertInput = {
  baseBranch?: string
  branchMode?: Doc<"codexRuns">["branchMode"]
  branchName?: string
  codexThreadId?: string
  ephemeralSandbox?: boolean
  logMessage: string
  model: Doc<"codexRuns">["model"]
  notifyParent?: boolean
  parentRunId?: Id<"codexRuns">
  parentThreadId?: Id<"threads">
  previousDiff?: string
  profile: string
  prompt: string
  reasoningEffort: Doc<"codexRuns">["reasoningEffort"]
  repoUrl: string
  rootThreadId?: Id<"threads">
  sandboxId?: string
  sandboxPresetId?: Id<"sandboxPresets">
  spawnDepth?: number
  speed: Doc<"codexRuns">["speed"]
  threadId: Id<"threads">
  userId: Id<"users">
}

/** Inserts everything a factory-created run needs on an existing thread: the
 * user + pending assistant messages, the run row with its dispatch lineage,
 * the run input, checkpoint, queued log, and the thread's pending flag.
 * Shared by run_dispatch, run_message, and the wake-up runs that report
 * finished children back to their dispatching thread. */
export async function insertFactoryRunRecords(
  ctx: MutationCtx,
  input: FactoryRunInsertInput
): Promise<FactoryRunCreated> {
  const now = Date.now()
  const userId = input.userId

  await ctx.db.insert("messages", {
    content: input.prompt,
    role: "user",
    threadId: input.threadId,
    userId,
  })
  const assistantMessageId = await ctx.db.insert("messages", {
    content: "",
    pending: true,
    role: "assistant",
    speed: input.speed,
    thinking: input.reasoningEffort,
    threadId: input.threadId,
    userId,
  })

  const runId = await ctx.db.insert("codexRuns", {
    assistantMessageId,
    ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
    ...(input.branchMode ? { branchMode: input.branchMode } : {}),
    ...(input.branchName ? { branchName: input.branchName } : {}),
    ...(input.codexThreadId ? { codexThreadId: input.codexThreadId } : {}),
    createdAt: now,
    ...(input.ephemeralSandbox ? { ephemeralSandbox: true } : {}),
    model: input.model,
    ...(input.notifyParent !== undefined
      ? { notifyParent: input.notifyParent }
      : {}),
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    ...(input.parentThreadId ? { parentThreadId: input.parentThreadId } : {}),
    profile: input.profile,
    reasoningEffort: input.reasoningEffort,
    repoUrl: input.repoUrl,
    ...(input.rootThreadId ? { rootThreadId: input.rootThreadId } : {}),
    ...(input.sandboxId
      ? { sandboxId: input.sandboxId, sandboxState: "running" as const }
      : {}),
    sandboxPresetId: input.sandboxPresetId,
    ...(input.spawnDepth !== undefined ? { spawnDepth: input.spawnDepth } : {}),
    speed: input.speed,
    status: "queued",
    threadId: input.threadId,
    updatedAt: now,
    userId,
  })

  const queuedLog = {
    kind: "setup" as const,
    message: input.logMessage,
    time: now,
  }
  await Promise.all([
    ctx.db.insert("codexRunInputs", {
      notesAccessToken: crypto.randomUUID(),
      ...(input.previousDiff ? { previousDiff: input.previousDiff } : {}),
      prompt: input.prompt,
      runId,
      userId,
    }),
    upsertCodexRunCheckpoint(
      ctx,
      { _id: runId, threadId: input.threadId, userId },
      { content: "" }
    ),
    appendCodexRunLogs(ctx, { _id: runId, threadId: input.threadId, userId }, [
      queuedLog,
    ]),
    ctx.db.patch(input.threadId, {
      hasPendingMessage: true,
      lastUserMessageAt: now,
      ...(input.sandboxId
        ? { sandboxId: input.sandboxId, sandboxState: "running" as const }
        : {}),
      updatedAt: now,
    }),
  ])

  return { runId, threadId: input.threadId, userId }
}
