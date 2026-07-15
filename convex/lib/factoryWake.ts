import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { findCodexAuth } from "./codexRunAuth"
import { activeRunForThread } from "./codexRunLifecycle"
import { insertFactoryRunRecords, type FactoryRunCreated } from "./factoryRuns"
import {
  closeWait,
  isActiveWaitStatus,
  pendingWaitEventsForThread,
} from "./factoryWaits"
import { resolveOwnedPresetOrAutoDefault } from "./sandboxPresets"

const TERMINAL_CHILD_STATUSES = ["succeeded", "failed", "canceled"] as const

/** Pending wait events drained into one wake run. Anything beyond the cap is
 * delivered by the next wake — the wake run's own completion re-runs the
 * check, so a backlog drains itself. */
const WAKE_WAIT_EVENT_BATCH = 50

const WAIT_EVENT_TEXT_MAX = 1500

type WaitEventDelivery = {
  event: Doc<"factoryWaitEvents">
  wait: Doc<"factoryWaits"> | null
}

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

function waitEventLines(deliveries: WaitEventDelivery[]) {
  return deliveries.flatMap(({ event, wait }) => {
    const label = wait?.note
      ? `Wait ${event.waitId} (${wait.note})`
      : `Wait ${event.waitId}`
    const summary =
      event.eventVars.summary ?? event.eventVars.event ?? "event received"
    const lines = [`- ${label} — ${summary}`]

    const text = event.eventVars.text
    if (text) {
      const truncated =
        text.length > WAIT_EVENT_TEXT_MAX
          ? `${text.slice(0, WAIT_EVENT_TEXT_MAX)}…`
          : text
      lines.push(...truncated.split("\n").map((line) => `  > ${line}`))
    }
    if (event.eventVars.url) lines.push(`  ${event.eventVars.url}`)
    return lines
  })
}

function factoryWakePrompt(
  children: Array<{ run: Doc<"codexRuns">; title?: string }>,
  waitDeliveries: WaitEventDelivery[]
) {
  const parts: string[] = []

  if (children.length) {
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
    parts.push(
      children.length === 1
        ? "Factory update: a run you dispatched has finished."
        : `Factory update: ${children.length} runs you dispatched have finished.`,
      "",
      ...lines,
      "",
      "Read their results with run_output and run_status, verify the work, and continue orchestrating. Use run_message for rework on a finished thread, run_dispatch for new tasks, and post a summary when everything is done."
    )
  }

  if (waitDeliveries.length) {
    if (parts.length) parts.push("")
    parts.push(
      waitDeliveries.length === 1
        ? "Factory update: an event you registered a wait for has arrived."
        : `Factory update: ${waitDeliveries.length} events you registered waits for have arrived.`,
      "",
      ...waitEventLines(waitDeliveries),
      "",
      "These waits are now consumed — register a new one with ask_human or wait_create if you need to keep listening. Continue the task with this new information."
    )
  }

  return parts.join("\n")
}

/** Delivers pending factory wake-ups for one thread: when it has finished
 * dispatched children that were never reported, or queued wait events, and
 * no run is active on it, queues one follow-up "wake" run summarizing all of
 * them and marks them reported. Coalesces naturally — children finishing and
 * events arriving while the thread is busy are picked up in a single wake
 * once the active run completes. */
export async function maybeCreateFactoryWakeRun(
  ctx: MutationCtx,
  threadId: Id<"threads">
): Promise<FactoryRunCreated | null> {
  const thread = await ctx.db.get(threadId)
  if (!thread) return null

  const [children, waitEvents] = await Promise.all([
    unreportedFinishedChildren(ctx, threadId),
    pendingWaitEventsForThread(ctx, threadId, WAKE_WAIT_EVENT_BATCH),
  ])
  if (!children.length && !waitEvents.length) return null

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

  const [sandboxPresetId, latestMessage, childThreads, waitDocs] =
    await Promise.all([
      resolveOwnedPresetOrAutoDefault(
        ctx,
        latest.sandboxPresetId ?? thread.sandboxPresetId,
        thread.userId
      ),
      ctx.db.get(latest.assistantMessageId),
      Promise.all(children.map((child) => ctx.db.get(child.threadId))),
      Promise.all(waitEvents.map((event) => ctx.db.get(event.waitId))),
    ])
  const waitDeliveries: WaitEventDelivery[] = waitEvents.map(
    (event, index) => ({ event, wait: waitDocs[index] })
  )
  const prompt = factoryWakePrompt(
    children.map((run, index) => ({ run, title: childThreads[index]?.title })),
    waitDeliveries
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
  await Promise.all([
    ...children.map((child) =>
      ctx.db.patch(child._id, { wakeReportedAt: now })
    ),
    ...waitEvents.map((event) =>
      ctx.db.patch(event._id, {
        status: "reported" as const,
        updatedAt: now,
        wakeRunId: created.runId,
      })
    ),
  ])

  // The wake consumes every wait it delivered for: single-shot semantics, so
  // a chatty PR or channel cannot wake the thread in a loop. Waits already
  // terminal (expired, failed) keep their status — only their queued events
  // needed delivering.
  const consumedWaits = new Map<string, Doc<"factoryWaits">>()
  for (const { wait } of waitDeliveries) {
    if (wait && isActiveWaitStatus(wait.status)) {
      consumedWaits.set(wait._id, wait)
    }
  }
  for (const wait of consumedWaits.values()) {
    await closeWait(ctx, wait, "fired")
  }

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
