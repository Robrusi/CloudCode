import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { recordAutomationRunOutcome } from "./automationRecords"
import { recordReviewRunOutcome } from "./reviewRecords"
import {
  compactMessageMeta,
  compactRunLogs,
  type StoredRunLog,
} from "./codexRunLogs"
import { codexRunCheckpoint, codexRunLogCheckpoint } from "./codexRunRecords"

export const TERMINAL_RUN_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
])

const ACTIVE_RUN_STATUS_VALUES = ["queued", "running", "canceling"] as const
const ACTIVE_RUN_STATUSES = new Set<string>(ACTIVE_RUN_STATUS_VALUES)

export function isActiveCodexRunStatus(status: Doc<"codexRuns">["status"]) {
  return ACTIVE_RUN_STATUSES.has(status)
}

export async function activeRunForThread(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">
) {
  const runs = await Promise.all(
    ACTIVE_RUN_STATUS_VALUES.map((status) =>
      ctx.db
        .query("codexRuns")
        .withIndex("by_thread_status_updated", (q) =>
          q.eq("threadId", threadId).eq("status", status)
        )
        .order("desc")
        .first()
    )
  )

  return runs
    .filter((run): run is Doc<"codexRuns"> => Boolean(run))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

export function sandboxIdFromLog(log: StoredRunLog) {
  if (log.kind !== "setup" || !log.detail) {
    return undefined
  }

  return log.message === "Daytona sandbox ready" ||
    log.message === "Recovered with a fresh Daytona sandbox"
    ? log.detail
    : undefined
}

export function latestSandboxIdForRun(
  run: Pick<Doc<"codexRuns">, "logs" | "sandboxId">
) {
  if (run.sandboxId) return run.sandboxId

  for (let index = (run.logs?.length ?? 0) - 1; index >= 0; index -= 1) {
    const sandboxId = sandboxIdFromLog(run.logs![index])
    if (sandboxId) return sandboxId
  }

  return undefined
}

export async function markRunCanceled(
  ctx: MutationCtx,
  run: Doc<"codexRuns">,
  content = "_Stopped._",
  sandboxIdOverride?: string
) {
  const now = Date.now()
  const sandboxId = sandboxIdOverride ?? latestSandboxIdForRun(run)
  const sandboxState =
    run.sandboxState ?? (sandboxId ? ("running" as const) : undefined)
  const [checkpoint, logCheckpoint] = await Promise.all([
    codexRunCheckpoint(ctx, run._id),
    codexRunLogCheckpoint(ctx, run._id),
  ])
  const currentContent = checkpoint?.content ?? run.content ?? ""
  const canceledContent = currentContent.trim()
    ? `${currentContent.trimEnd()}\n\n${content}`
    : content

  const sandboxPatch = {
    ...(sandboxId ? { sandboxId } : {}),
    ...(sandboxState ? { sandboxState } : {}),
  }
  // Ephemeral runs keep the sandbox on the run doc (billing and cleanup need
  // it) but never stamp it onto the thread — it is deleted at run end.
  const threadSandboxPatch = run.ephemeralSandbox ? {} : sandboxPatch
  const becameCanceled = !TERMINAL_RUN_STATUSES.has(run.status)

  if (becameCanceled) {
    await ctx.db.patch(run._id, {
      finishedAt: now,
      ...sandboxPatch,
      status: "canceled",
      updatedAt: now,
    })
  } else if (sandboxId && run.sandboxId !== sandboxId) {
    await ctx.db.patch(run._id, {
      ...sandboxPatch,
      updatedAt: now,
    })
  }

  const message = await ctx.db.get(run.assistantMessageId)
  if (
    message &&
    message.threadId === run.threadId &&
    message.userId === run.userId &&
    message.role === "assistant" &&
    message.pending
  ) {
    const existingMeta = compactMessageMeta(message.meta)
    const runLogs = compactRunLogs(
      logCheckpoint?.logs ?? checkpoint?.logs ?? run.logs
    )
    await ctx.db.patch(message._id, {
      content: canceledContent,
      error: false,
      meta:
        existingMeta || runLogs.length
          ? {
              ...existingMeta,
              ...(runLogs.length ? { logs: runLogs } : {}),
            }
          : undefined,
      pending: false,
    })
  }

  await ctx.db.patch(run.threadId, {
    hasPendingMessage: false,
    ...threadSandboxPatch,
    updatedAt: now,
  })

  if (becameCanceled) {
    await recordAutomationRunOutcome(ctx, run, "canceled")
    await recordReviewRunOutcome(ctx, run, "canceled")
  }

  return {
    sandboxId,
    sandboxState,
  }
}

export async function markRunCanceling(
  ctx: MutationCtx,
  run: Doc<"codexRuns">
) {
  const now = Date.now()
  const sandboxId = latestSandboxIdForRun(run)
  const sandboxState =
    run.sandboxState ?? (sandboxId ? ("running" as const) : undefined)

  await Promise.all([
    ctx.db.patch(run._id, {
      ...(sandboxId ? { sandboxId } : {}),
      ...(sandboxState ? { sandboxState } : {}),
      status: "canceling",
      updatedAt: now,
    }),
    ctx.db.patch(run.threadId, {
      hasPendingMessage: true,
      ...(sandboxId && !run.ephemeralSandbox ? { sandboxId } : {}),
      ...(sandboxState && !run.ephemeralSandbox ? { sandboxState } : {}),
      updatedAt: now,
    }),
  ])

  return {
    sandboxId,
    sandboxState,
  }
}
