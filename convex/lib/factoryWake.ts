import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { findCodexAuth } from "./codexRunAuth"
import { activeRunForThread } from "./codexRunLifecycle"
import { insertFactoryRunRecords, type FactoryRunCreated } from "./factoryRuns"
import { resolveOwnedPresetOrAutoDefault } from "./sandboxPresets"

const TERMINAL_CHILD_STATUSES = ["succeeded", "failed", "canceled"] as const

async function unreportedFinishedChildren(
  ctx: MutationCtx,
  threadId: Id<"threads">
) {
  const childrenByStatus = await Promise.all(
    TERMINAL_CHILD_STATUSES.map((status) =>
      ctx.db
        .query("codexRuns")
        .withIndex("by_parent_thread_status", (q) =>
          q.eq("parentThreadId", threadId).eq("status", status)
        )
        .collect()
    )
  )

  return childrenByStatus
    .flat()
    .filter((child) => child.notifyParent && !child.wakeReportedAt)
    .sort((a, b) => a.createdAt - b.createdAt)
}

function factoryWakePrompt(
  children: Array<{ run: Doc<"codexRuns">; title?: string }>
) {
  const lines = children.map(({ run, title }) =>
    [
      `- ${run._id}`,
      run.status,
      title,
      run.branchName ? `branch ${run.branchName}` : undefined,
      run.prUrl,
      run.error ? `error: ${run.error}` : undefined,
    ]
      .filter(Boolean)
      .join(" | ")
  )

  return [
    children.length === 1
      ? "Factory update: a run you dispatched has finished."
      : `Factory update: ${children.length} runs you dispatched have finished.`,
    "",
    ...lines,
    "",
    "Read their results with run_output and run_status, verify the work, and continue orchestrating. Use run_message for rework on a finished thread, run_dispatch for new tasks, and post a summary when everything is done.",
  ].join("\n")
}

/** Delivers pending factory wake-ups for one thread: when it has finished
 * dispatched children that were never reported and no run is active on it,
 * queues one follow-up "wake" run summarizing all of them and marks them
 * reported. Coalesces naturally — children finishing while the thread is
 * busy are picked up in a single wake once the active run completes. */
export async function maybeCreateFactoryWakeRun(
  ctx: MutationCtx,
  threadId: Id<"threads">
): Promise<FactoryRunCreated | null> {
  const thread = await ctx.db.get(threadId)
  if (!thread) return null

  const children = await unreportedFinishedChildren(ctx, threadId)
  if (!children.length) return null

  if (thread.hasPendingMessage) {
    const activeRun = await activeRunForThread(ctx, threadId)
    // Delivered when that run finishes — its completion re-runs this check.
    if (activeRun) return null
  }

  // The thread's latest run carries the continuation recipe (model, branch,
  // codex thread, lineage) the wake run resumes with.
  const latest = await ctx.db
    .query("codexRuns")
    .withIndex("by_thread_updated", (q) => q.eq("threadId", threadId))
    .order("desc")
    .first()
  if (!latest) return null

  // A user-canceled run is the loop's off switch: no automatic wake-ups
  // until the user re-engages the thread. Children finishing meanwhile stay
  // unreported and are delivered in one wake after the next run completes,
  // so stopping the orchestrator also lets its sandbox pause.
  if (latest.status === "canceled" || latest.status === "canceling") {
    return null
  }

  // Headless run: without valid codex auth the wake cannot execute. Leave
  // the children unreported so a later completion retries the delivery.
  const { auth } = await findCodexAuth(ctx, thread.userId, latest.profile, {
    fallbackToActive: true,
  })
  if (!auth || auth.invalidatedAt) return null

  const [sandboxPresetId, latestMessage, childThreads] = await Promise.all([
    resolveOwnedPresetOrAutoDefault(
      ctx,
      latest.sandboxPresetId ?? thread.sandboxPresetId,
      thread.userId
    ),
    ctx.db.get(latest.assistantMessageId),
    Promise.all(children.map((child) => ctx.db.get(child.threadId))),
  ])
  const prompt = factoryWakePrompt(
    children.map((run, index) => ({ run, title: childThreads[index]?.title }))
  )

  const created = await insertFactoryRunRecords(ctx, {
    baseBranch: thread.baseBranch ?? latest.baseBranch,
    branchMode: thread.branchMode ?? latest.branchMode,
    branchName: latest.branchName,
    codexThreadId: thread.codexThreadId,
    logMessage: "Queued factory wake-up run",
    model: latest.model,
    notifyParent: latest.notifyParent,
    parentRunId: latest.parentRunId,
    parentThreadId: latest.parentThreadId,
    previousDiff: latestMessage?.meta?.diff,
    profile: latest.profile ?? auth.profile,
    prompt,
    reasoningEffort: latest.reasoningEffort,
    repoUrl: latest.repoUrl,
    rootThreadId: latest.rootThreadId,
    sandboxId: thread.sandboxState !== "deleted" ? thread.sandboxId : undefined,
    sandboxPresetId,
    spawnDepth: latest.spawnDepth,
    speed: latest.speed,
    threadId,
    userId: thread.userId,
  })

  const now = Date.now()
  await Promise.all(
    children.map((child) => ctx.db.patch(child._id, { wakeReportedAt: now }))
  )

  return created
}

/** Wake-up delivery after a run reaches a terminal status: the run's own
 * thread may have queued reports waiting for it to free up, and — when the
 * run is a dispatched child with notifyParent — its dispatching thread gets
 * woken about it. The caller must trigger factory-dispatch for each created
 * run; queued wake runs go nowhere on their own. */
export async function factoryWakeRunsAfterFinish(
  ctx: MutationCtx,
  run: Doc<"codexRuns">
): Promise<FactoryRunCreated[]> {
  const targets = new Set<Id<"threads">>([run.threadId])
  if (run.parentThreadId && run.notifyParent) {
    targets.add(run.parentThreadId)
  }

  const created: FactoryRunCreated[] = []
  for (const threadId of targets) {
    const wake = await maybeCreateFactoryWakeRun(ctx, threadId)
    if (wake) created.push(wake)
  }

  return created
}
