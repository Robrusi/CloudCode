import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { compactRunLogs, type StoredRunLog } from "./codexRunLogs"

type RunRecordForCheckpoint = Pick<
  Doc<"codexRuns">,
  "_id" | "threadId" | "userId"
> &
  Partial<Pick<Doc<"codexRuns">, "content" | "logs">>

export async function codexRunInput(
  ctx: QueryCtx | MutationCtx,
  runId: Id<"codexRuns">
) {
  return await ctx.db
    .query("codexRunInputs")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .unique()
}

export async function codexRunCheckpoint(
  ctx: QueryCtx | MutationCtx,
  runId: Id<"codexRuns">
) {
  return await ctx.db
    .query("codexRunCheckpoints")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .unique()
}

export async function codexRunLogCheckpoint(
  ctx: QueryCtx | MutationCtx,
  runId: Id<"codexRuns">
) {
  return await ctx.db
    .query("codexRunLogCheckpoints")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .unique()
}

/**
 * Compacted logs for a run, preferring the dedicated log checkpoint and
 * falling back to legacy locations (content checkpoint, then the run doc).
 */
export async function codexRunLogsForRun(
  ctx: QueryCtx | MutationCtx,
  run: RunRecordForCheckpoint
) {
  const existing = await codexRunLogCheckpoint(ctx, run._id)
  if (existing) return compactRunLogs(existing.logs)

  const legacy = await codexRunCheckpoint(ctx, run._id)
  return compactRunLogs(legacy?.logs ?? run.logs)
}

export async function appendCodexRunLogs(
  ctx: MutationCtx,
  run: RunRecordForCheckpoint,
  incoming: StoredRunLog[]
) {
  const existing = await codexRunLogCheckpoint(ctx, run._id)
  // Legacy fallback is read once: after the first append the dedicated log
  // checkpoint exists and the content checkpoint stays out of this hot path.
  const baseLogs = existing
    ? existing.logs
    : ((await codexRunCheckpoint(ctx, run._id))?.logs ?? run.logs ?? [])
  const logs = compactRunLogs([...baseLogs, ...incoming])
  const updatedAt = Date.now()

  if (existing) {
    await ctx.db.patch(existing._id, { logs, updatedAt })
    return logs
  }

  await ctx.db.insert("codexRunLogCheckpoints", {
    logs,
    runId: run._id,
    threadId: run.threadId,
    updatedAt,
    userId: run.userId,
  })
  return logs
}

export async function upsertCodexRunCheckpoint(
  ctx: MutationCtx,
  run: RunRecordForCheckpoint,
  patch: {
    content?: string
    lastStreamId?: string
  }
) {
  const existing = await codexRunCheckpoint(ctx, run._id)
  const content = patch.content ?? existing?.content ?? run.content ?? ""
  const lastStreamId = patch.lastStreamId ?? existing?.lastStreamId
  const updatedAt = Date.now()
  const value = {
    content,
    contentLength: content.length,
    ...(lastStreamId ? { lastStreamId } : {}),
    updatedAt,
  }

  if (existing) {
    await ctx.db.patch(existing._id, value)
    return existing._id
  }

  return await ctx.db.insert("codexRunCheckpoints", {
    ...value,
    runId: run._id,
    threadId: run.threadId,
    userId: run.userId,
  })
}
