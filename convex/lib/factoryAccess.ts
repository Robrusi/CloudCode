import { v } from "convex/values"

import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { isActiveCodexRunStatus } from "./codexRunLifecycle"
import { codexRunInput } from "./codexRunRecords"

/** Argument set every factory MCP tool call carries: the per-run access
 * token plus the run and thread ids from the sandbox state file. */
export const factoryAccessArgs = {
  accessToken: v.string(),
  runId: v.id("codexRuns"),
  threadId: v.id("threads"),
}

/**
 * Authenticates a factory MCP tool call: the caller must present the per-run
 * access token minted at run creation (the same token that guards the shared
 * notes tools), together with the run and thread ids from the sandbox state
 * file. Mirrors requireRunThreadNotesAccess in ./threadNotes.
 */
export async function requireFactoryRunAccess(
  ctx: QueryCtx | MutationCtx,
  args: {
    accessToken: string
    runId: Id<"codexRuns">
    threadId: Id<"threads">
  }
) {
  const [run, input, thread] = await Promise.all([
    ctx.db.get(args.runId),
    codexRunInput(ctx, args.runId),
    ctx.db.get(args.threadId),
  ])
  const accessToken = input?.notesAccessToken ?? run?.notesAccessToken

  if (
    !run ||
    !thread ||
    run.threadId !== args.threadId ||
    thread.userId !== run.userId ||
    !accessToken ||
    accessToken !== args.accessToken
  ) {
    throw new Error("Factory tools are unavailable for this run.")
  }

  return run
}

/**
 * Same as requireFactoryRunAccess, but for tools that create work (dispatch,
 * follow-up runs, automations): only a run that is still executing may spawn
 * anything, so a leaked token from a finished run is inert.
 */
export async function requireActiveFactoryRunAccess(
  ctx: QueryCtx | MutationCtx,
  args: {
    accessToken: string
    runId: Id<"codexRuns">
    threadId: Id<"threads">
  }
) {
  const run = await requireFactoryRunAccess(ctx, args)
  if (run.status !== "running") {
    throw new Error("Only a running agent can dispatch factory work.")
  }

  return run
}

/** The root of the dispatch tree a run belongs to: inherited from the
 * dispatching parent, or the run's own thread for a manually started run. */
export function factoryRootThreadId(run: Doc<"codexRuns">) {
  return run.rootThreadId ?? run.threadId
}

/** True when target is visible to the caller's factory tools: same user and
 * inside the caller's dispatch tree. */
export function isRunInFactoryTree(
  caller: Doc<"codexRuns">,
  target: Doc<"codexRuns">
) {
  return (
    target.userId === caller.userId &&
    (target._id === caller._id ||
      target.rootThreadId === factoryRootThreadId(caller))
  )
}

/** Queued/running/canceling dispatched runs for a user, for the concurrency
 * cap. Dispatched runs are exactly those carrying a parentRunId. */
export async function countActiveDispatchedRuns(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  const activeStatuses = ["queued", "running", "canceling"] as const
  const runsByStatus = await Promise.all(
    activeStatuses.map((status) =>
      ctx.db
        .query("codexRuns")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", userId).eq("status", status)
        )
        .collect()
    )
  )

  return runsByStatus
    .flat()
    .filter((run) => isActiveCodexRunStatus(run.status) && run.parentRunId)
    .length
}
