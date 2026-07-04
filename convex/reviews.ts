import { v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server"
import { findCodexAuth } from "./lib/codexRunAuth"
import {
  isActiveCodexRunStatus,
  markRunCanceling,
} from "./lib/codexRunLifecycle"
import {
  appendCodexRunLogs,
  upsertCodexRunCheckpoint,
} from "./lib/codexRunRecords"
import { model, speed, thinking } from "./lib/codexRunValidators"
import { disableReview, recordReviewFailure } from "./lib/reviewRecords"
import { resolveOwnedPresetOrAutoDefault } from "./lib/sandboxPresets"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"
import {
  codexAuthMissingMessage,
  codexAuthReconnectMessage,
} from "@/lib/codex/auth-errors"
import { canonicalGitHubRepoUrl } from "@/lib/github/repo"
import { parseReviewAuthorFilters } from "@/lib/reviews/config"
import { buildReviewPrompt } from "@/lib/reviews/prompt"

const THREAD_TITLE_MAX_LENGTH = 120

const reviewConfigArgs = {
  authorFilterMode: v.optional(v.union(v.literal("allow"), v.literal("block"))),
  authorFilters: v.optional(v.array(v.string())),
  autoEnvironment: v.optional(v.boolean()),
  autofix: v.optional(v.boolean()),
  model,
  name: v.string(),
  profile: v.optional(v.string()),
  prompt: v.optional(v.string()),
  reasoningEffort: thinking,
  repoUrl: v.string(),
  reviewOnPush: v.optional(v.boolean()),
  reviewReadyForReview: v.optional(v.boolean()),
  sandboxPresetId: v.optional(v.id("sandboxPresets")),
  speed,
}

type ReviewConfigArgs = {
  authorFilterMode?: Doc<"reviews">["authorFilterMode"]
  authorFilters?: string[]
  autoEnvironment?: boolean
  autofix?: boolean
  model: Doc<"reviews">["model"]
  name: string
  profile?: string
  prompt?: string
  reasoningEffort: Doc<"reviews">["reasoningEffort"]
  repoUrl: string
  reviewOnPush?: boolean
  reviewReadyForReview?: boolean
  sandboxPresetId?: Id<"sandboxPresets">
  speed: Doc<"reviews">["speed"]
}

const reviewPullRequestArgs = v.object({
  authorLogin: v.optional(v.string()),
  baseRef: v.string(),
  body: v.optional(v.string()),
  crossFork: v.boolean(),
  headRef: v.string(),
  headSha: v.string(),
  htmlUrl: v.string(),
  number: v.number(),
  title: v.string(),
})

// Reviews are triggered by GitHub webhooks, so the repo must be a GitHub URL
// stored in canonical form for the webhook's repository lookup to match.
function validateReviewConfig(args: ReviewConfigArgs) {
  if (!args.name.trim()) throw new Error("name is required.")
  const repoUrl = canonicalGitHubRepoUrl(args.repoUrl)
  if (!repoUrl) throw new Error("repoUrl must be a GitHub repository URL.")

  // A filter mode without logins would match nothing (allow) or everything
  // (block) — store neither so the config plainly reviews everyone.
  const authorFilters = parseReviewAuthorFilters(args.authorFilters)
  const authorFilterMode = authorFilters.length
    ? args.authorFilterMode
    : undefined

  return {
    authorFilterMode,
    authorFilters: authorFilterMode ? authorFilters : undefined,
    repoUrl,
  }
}

async function requireOwnedReview(
  ctx: MutationCtx,
  reviewId: Id<"reviews">,
  userId: Id<"users">
) {
  const review = await ctx.db.get(reviewId)
  if (!review || review.userId !== userId) {
    throw new Error("Review not found.")
  }

  return review
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []

    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect()

    return reviews
  },
})

export const get = query({
  args: {
    reviewId: v.id("reviews"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    const review = await ctx.db.get(args.reviewId)
    if (!review || review.userId !== user._id) return null

    return review
  },
})

export const create = mutation({
  args: reviewConfigArgs,
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const { authorFilterMode, authorFilters, repoUrl } =
      validateReviewConfig(args)
    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      args.sandboxPresetId,
      userId,
      { autoEnvironment: args.autoEnvironment }
    )

    const now = Date.now()
    const reviewId = await ctx.db.insert("reviews", {
      ...(authorFilterMode ? { authorFilterMode, authorFilters } : {}),
      autoEnvironment: args.autoEnvironment,
      ...(args.autofix ? { autofix: true } : {}),
      createdAt: now,
      enabled: true,
      failureCount: 0,
      model: args.model,
      name: args.name.trim(),
      ...(args.profile ? { profile: args.profile } : {}),
      ...(args.prompt?.trim() ? { prompt: args.prompt.trim() } : {}),
      reasoningEffort: args.reasoningEffort,
      repoUrl,
      ...(args.reviewOnPush ? { reviewOnPush: true } : {}),
      ...(args.reviewReadyForReview ? { reviewReadyForReview: true } : {}),
      sandboxPresetId,
      speed: args.speed,
      updatedAt: now,
      userId,
    })

    return { reviewId }
  },
})

export const update = mutation({
  args: {
    ...reviewConfigArgs,
    reviewId: v.id("reviews"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const { authorFilterMode, authorFilters, repoUrl } =
      validateReviewConfig(args)
    const review = await requireOwnedReview(ctx, args.reviewId, userId)
    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      args.sandboxPresetId,
      userId,
      { autoEnvironment: args.autoEnvironment }
    )

    await ctx.db.patch(review._id, {
      authorFilterMode,
      authorFilters,
      autoEnvironment: args.autoEnvironment,
      autofix: args.autofix || undefined,
      model: args.model,
      name: args.name.trim(),
      profile: args.profile,
      prompt: args.prompt?.trim() || undefined,
      reasoningEffort: args.reasoningEffort,
      repoUrl,
      reviewOnPush: args.reviewOnPush || undefined,
      reviewReadyForReview: args.reviewReadyForReview || undefined,
      sandboxPresetId,
      speed: args.speed,
      updatedAt: Date.now(),
    })

    return { reviewId: review._id }
  },
})

export const setEnabled = mutation({
  args: {
    enabled: v.boolean(),
    reviewId: v.id("reviews"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const review = await requireOwnedReview(ctx, args.reviewId, userId)

    await ctx.db.patch(review._id, {
      disabledReason: undefined,
      enabled: args.enabled,
      ...(args.enabled ? { failureCount: 0 } : {}),
      updatedAt: Date.now(),
    })
  },
})

export const remove = mutation({
  args: {
    reviewId: v.id("reviews"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const review = await requireOwnedReview(ctx, args.reviewId, userId)

    // Run threads carry real conversation history. Deleting the config also
    // removes the run-history UI that reaches them, so release them into the
    // regular chat list instead of leaving them orphaned and invisible.
    const runs = await ctx.db
      .query("codexRuns")
      .withIndex("by_review_created", (q) => q.eq("reviewId", review._id))
      .collect()
    const threadIds = [...new Set(runs.map((run) => run.threadId))]
    await Promise.all(
      threadIds.map(async (threadId) => {
        const thread = await ctx.db.get(threadId)
        if (thread?.reviewId === review._id) {
          await ctx.db.patch(threadId, { reviewId: undefined })
        }
      })
    )

    await ctx.db.delete(review._id)
  },
})

const RECENT_RUNS_MAX_LIMIT = 100

/** Latest runs of one review, for the expandable row on the screen. Fetches
 * one row past `limit` so the client knows whether to offer more. */
export const recentRuns = query({
  args: {
    limit: v.number(),
    reviewId: v.id("reviews"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return { hasMore: false, runs: [] }

    const review = await ctx.db.get(args.reviewId)
    if (!review || review.userId !== user._id) {
      return { hasMore: false, runs: [] }
    }

    const limit = Math.min(
      Math.max(Math.floor(args.limit), 1),
      RECENT_RUNS_MAX_LIMIT
    )
    const runs = await ctx.db
      .query("codexRuns")
      .withIndex("by_review_created", (q) => q.eq("reviewId", args.reviewId))
      .order("desc")
      .take(limit + 1)

    return {
      hasMore: runs.length > limit,
      runs: runs.slice(0, limit).map((run) => ({
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
        id: run._id,
        prNumber: run.prNumber,
        prTitle: run.prTitle,
        prUrl: run.prUrl,
        reviewCommentUrl: run.reviewCommentUrl,
        status: run.status,
        threadId: run.threadId,
      })),
    }
  },
})

// The webhook fires for a repository, not a user: signature verification
// authenticates the event, and per-user authorization happens downstream at
// GitHub token mint and codex auth lookup.
export const listEnabledForRepoForWorker = query({
  args: {
    repoUrl: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_repo_enabled", (q) =>
        q.eq("repoUrl", args.repoUrl).eq("enabled", true)
      )
      .collect()

    return reviews.map((review) => ({
      _id: review._id,
      authorFilterMode: review.authorFilterMode,
      authorFilters: review.authorFilters,
      reviewOnPush: review.reviewOnPush ?? false,
      reviewReadyForReview: review.reviewReadyForReview ?? false,
      userId: review.userId,
    }))
  },
})

export const getForWorker = query({
  args: {
    reviewId: v.id("reviews"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    return await ctx.db.get(args.reviewId)
  },
})

/** The most recent finished review of a PR, for re-review context: the new
 * run tells the agent what it previously found and at which commit. */
export const workerGetLatestRunForPr = query({
  args: {
    prNumber: v.number(),
    reviewId: v.id("reviews"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const runs = await ctx.db
      .query("codexRuns")
      .withIndex("by_review_pr", (q) =>
        q.eq("reviewId", args.reviewId).eq("prNumber", args.prNumber)
      )
      .order("desc")
      .collect()
    const latest = runs.find((run) => run.status === "succeeded")
    if (!latest) return null

    const message = await ctx.db.get(latest.assistantMessageId)

    return {
      content: message?.content ?? "",
      finishedAt: latest.finishedAt,
      prHeadSha: latest.prHeadSha,
    }
  },
})

export const workerCreateRun = mutation({
  args: {
    additionalContext: v.optional(v.string()),
    githubToken: v.optional(v.string()),
    githubUserEmail: v.optional(v.string()),
    githubUserName: v.optional(v.string()),
    githubUsername: v.optional(v.string()),
    manual: v.boolean(),
    notesAccessToken: v.string(),
    pr: reviewPullRequestArgs,
    reviewId: v.id("reviews"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const review = await ctx.db.get(args.reviewId)
    if (!review) {
      return { ok: false as const, status: "not_found" as const }
    }
    if (!review.enabled && !args.manual) {
      return { ok: false as const, status: "disabled" as const }
    }

    // Duplicate webhook deliveries (and opened + ready_for_review with an
    // unchanged head) must not review the same commit twice. Manual runs are
    // an explicit request, so they always go through.
    if (!args.manual) {
      const priorRuns = await ctx.db
        .query("codexRuns")
        .withIndex("by_review_pr", (q) =>
          q.eq("reviewId", args.reviewId).eq("prNumber", args.pr.number)
        )
        .collect()
      const duplicate = priorRuns.some(
        (run) => run.prHeadSha === args.pr.headSha && run.status !== "canceled"
      )
      if (duplicate) {
        return { ok: false as const, status: "duplicate" as const }
      }

      // Supersede: a run still reviewing an older head would post a comment
      // about code that no longer exists. At most one active run per PR,
      // always on the newest head.
      const staleRuns = priorRuns.filter(
        (run) =>
          isActiveCodexRunStatus(run.status) && run.status !== "canceling"
      )
      for (const staleRun of staleRuns) {
        await markRunCanceling(ctx, staleRun)
      }
    }

    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      review.sandboxPresetId,
      review.userId,
      { autoEnvironment: review.autoEnvironment }
    )
    const { auth, profile: authProfile } = await findCodexAuth(
      ctx,
      review.userId,
      review.profile,
      { fallbackToActive: true }
    )
    if (!auth) {
      return {
        ok: false as const,
        message: codexAuthMissingMessage(authProfile),
        status: "missing_auth" as const,
      }
    }
    if (auth.invalidatedAt) {
      return {
        ok: false as const,
        message: codexAuthReconnectMessage(authProfile),
        status: "auth_reconnect_required" as const,
      }
    }

    const now = Date.now()
    const userId = review.userId
    const basePrompt = buildReviewPrompt(
      review.prompt,
      review.repoUrl,
      args.pr,
      { autofix: review.autofix ?? false }
    )
    const additionalContext = args.additionalContext?.trim()
    const prompt = additionalContext
      ? `${basePrompt}\n\n---\n\n${additionalContext}`
      : basePrompt
    const title = `PR #${args.pr.number}: ${args.pr.title}`

    // Each pull request gets its own thread. reviewId keeps it out of the
    // chat list; it is reached from the Review tab's run history instead.
    const threadId = await ctx.db.insert("threads", {
      baseBranch: args.pr.baseRef,
      branchMode: "base",
      reviewId: review._id,
      createdAt: now,
      model: review.model,
      repoUrl: review.repoUrl,
      sandboxPresetId,
      title:
        title.length > THREAD_TITLE_MAX_LENGTH
          ? `${title.slice(0, THREAD_TITLE_MAX_LENGTH)}…`
          : title,
      updatedAt: now,
      userId,
    })

    await ctx.db.insert("messages", {
      content: prompt,
      role: "user",
      threadId,
      userId,
    })
    const assistantMessageId = await ctx.db.insert("messages", {
      content: "",
      pending: true,
      role: "assistant",
      speed: review.speed,
      thinking: review.reasoningEffort,
      threadId,
      userId,
    })

    const queuedLog = {
      kind: "setup" as const,
      message: `Queued review of PR #${args.pr.number}`,
      time: now,
    }
    const runId = await ctx.db.insert("codexRuns", {
      assistantMessageId,
      baseBranch: args.pr.baseRef,
      branchMode: "base",
      createdAt: now,
      ephemeralSandbox: true,
      model: review.model,
      prHeadSha: args.pr.headSha,
      prNumber: args.pr.number,
      prTitle: args.pr.title,
      prUrl: args.pr.htmlUrl,
      profile: auth.profile,
      reasoningEffort: review.reasoningEffort,
      repoUrl: review.repoUrl,
      reviewId: review._id,
      sandboxPresetId,
      speed: review.speed,
      status: "queued",
      threadId,
      updatedAt: now,
      userId,
      ...(args.githubUserEmail
        ? { githubUserEmail: args.githubUserEmail }
        : {}),
      ...(args.githubUserName ? { githubUserName: args.githubUserName } : {}),
      ...(args.githubUsername ? { githubUsername: args.githubUsername } : {}),
    })

    await Promise.all([
      ctx.db.insert("codexRunInputs", {
        ...(args.githubToken ? { githubToken: args.githubToken } : {}),
        notesAccessToken: args.notesAccessToken,
        prompt,
        runId,
        userId,
      }),
      upsertCodexRunCheckpoint(
        ctx,
        { _id: runId, threadId, userId },
        { content: "" }
      ),
      appendCodexRunLogs(ctx, { _id: runId, threadId, userId }, [queuedLog]),
      ctx.db.patch(threadId, {
        hasPendingMessage: true,
        lastUserMessageAt: now,
        updatedAt: now,
      }),
      ctx.db.patch(review._id, {
        lastRunAt: now,
        lastRunError: undefined,
        lastRunStatus: "running",
        updatedAt: now,
      }),
    ])

    return {
      ok: true as const,
      runId,
      threadId,
      userId,
    }
  },
})

// One-off backfill: stamp reviewId onto threads created by review runs
// before threads carried the flag. Idempotent; skips threads whose review
// config no longer exists (deletion releases threads to the chat list).
export const backfillThreadReviewIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db
      .query("codexRuns")
      .filter((q) => q.neq(q.field("reviewId"), undefined))
      .collect()

    let patched = 0
    const seen = new Set<string>()
    for (const run of runs) {
      if (!run.reviewId || seen.has(run.threadId as string)) continue
      seen.add(run.threadId as string)
      const [thread, review] = await Promise.all([
        ctx.db.get(run.threadId),
        ctx.db.get(run.reviewId),
      ])
      if (thread && review && !thread.reviewId) {
        await ctx.db.patch(run.threadId, { reviewId: run.reviewId })
        patched += 1
      }
    }

    return { patched, reviewRuns: runs.length }
  },
})

export const recordSkipForWorker = mutation({
  args: {
    reviewId: v.id("reviews"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const review = await ctx.db.get(args.reviewId)
    if (!review) return

    await ctx.db.patch(review._id, {
      lastRunAt: Date.now(),
      lastRunStatus: "skipped",
      updatedAt: Date.now(),
    })
  },
})

export const recordDispatchFailureForWorker = mutation({
  args: {
    error: v.string(),
    reviewId: v.id("reviews"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const review = await ctx.db.get(args.reviewId)
    if (!review) return

    await recordReviewFailure(ctx, review, "dispatch_failed", args.error)
  },
})

export const disableForWorker = mutation({
  args: {
    reason: v.string(),
    reviewId: v.id("reviews"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const review = await ctx.db.get(args.reviewId)
    if (!review) return

    await disableReview(ctx, review, args.reason)
  },
})

/** The finished run's report for the comment-posting step. Content lives on
 * the assistant message: workerComplete writes it there, not on the run. */
export const workerGetRunOutcome = query({
  args: {
    runId: v.id("codexRuns"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const run = await ctx.db.get(args.runId)
    if (!run?.reviewId) return null

    const message = await ctx.db.get(run.assistantMessageId)

    return {
      content: message?.content ?? "",
      prNumber: run.prNumber,
      prUrl: run.prUrl,
      reviewId: run.reviewId,
      status: run.status,
      threadId: run.threadId,
    }
  },
})

export const workerRecordCommentPosted = mutation({
  args: {
    commentUrl: v.string(),
    runId: v.id("codexRuns"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const run = await ctx.db.get(args.runId)
    if (!run?.reviewId) return

    const now = Date.now()
    await Promise.all([
      ctx.db.patch(run._id, {
        reviewCommentUrl: args.commentUrl,
        updatedAt: now,
      }),
      appendCodexRunLogs(ctx, run, [
        {
          detail: args.commentUrl,
          kind: "setup" as const,
          message: "Posted review comment",
          time: now,
        },
      ]),
    ])
  },
})

export const workerRecordCommentFailure = mutation({
  args: {
    error: v.string(),
    reviewId: v.id("reviews"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const review = await ctx.db.get(args.reviewId)
    if (!review) return

    await recordReviewFailure(ctx, review, "failed", args.error)
  },
})
