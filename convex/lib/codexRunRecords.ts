import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { StoredRunLog } from "./codexRunLogs"

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

export async function upsertCodexRunCheckpoint(
  ctx: MutationCtx,
  run: RunRecordForCheckpoint,
  patch: {
    content?: string
    lastStreamId?: string
    logs?: StoredRunLog[]
  }
) {
  const existing = await codexRunCheckpoint(ctx, run._id)
  const content = patch.content ?? existing?.content ?? run.content ?? ""
  const logs = patch.logs ?? existing?.logs ?? run.logs
  const lastStreamId = patch.lastStreamId ?? existing?.lastStreamId
  const updatedAt = Date.now()
  const value = {
    content,
    contentLength: content.length,
    ...(lastStreamId ? { lastStreamId } : {}),
    ...(logs?.length ? { logs } : {}),
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
