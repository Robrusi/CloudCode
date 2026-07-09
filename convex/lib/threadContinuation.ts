import type { Doc } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

/** The chat client's continuation recipe for running again on an existing
 * thread: resume the Codex thread and sandbox when they survive, and carry
 * the previous diff so a fresh sandbox can restore the working tree. Shared
 * by factory run_message and integration follow-up runs. */
export async function threadContinuationInput(
  ctx: QueryCtx | MutationCtx,
  thread: Doc<"threads">
) {
  const latest = await ctx.db
    .query("codexRuns")
    .withIndex("by_thread_updated", (q) => q.eq("threadId", thread._id))
    .order("desc")
    .first()
  const latestMessage = latest
    ? await ctx.db.get(latest.assistantMessageId)
    : null

  return {
    codexThreadId: thread.codexThreadId,
    latest,
    previousDiff: latestMessage?.meta?.diff,
    sandboxId: thread.sandboxState !== "deleted" ? thread.sandboxId : undefined,
  }
}
