import { task, tasks } from "@trigger.dev/sdk"
import { randomUUID } from "node:crypto"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { finalRunMessageFromContent } from "@/lib/codex/run-log"
import {
  failWorkerRun,
  getWorkerSecret,
  workerConvexClient,
} from "@/lib/codex/run-worker"
import { createWorkerGitHubRepoCredential } from "@/lib/github/app-worker"
import {
  addIssueCommentReaction,
  addPullRequestReaction,
  createIssueComment,
  createPullRequestReview,
  getPullRequest,
  GitHubApiError,
  getPullRequestCommits,
  getPullRequestConversation,
  removePullRequestReviewers,
  requestPullRequestReviewers,
  setCommitStatus,
} from "@/lib/github/pull-requests"
import { parseGitHubRepoUrl, type GitHubRepo } from "@/lib/github/repo"
import { cloudcodeBotLogin } from "@/lib/github/webhook"
import { reviewAllowsAuthor } from "@/lib/reviews/config"
import { buildReviewRerunContext } from "@/lib/reviews/prompt"
import {
  normalizeReviewPullRequestContext,
  type ReviewPullRequestContext,
} from "@/lib/reviews/pull-request"
import { encryptSecret } from "@/lib/security/secret-crypto"
import type { cloudcodeRun } from "@/trigger/cloudcode-run"

const BILLING_EXHAUSTED_ERROR =
  "Infrastructure usage is exhausted. Upgrade to Hobby or Plus, or wait for your included usage to reset."
const GITHUB_ACCESS_ERROR =
  "Install the GitHub App on this repository and authorize your GitHub user; posting the review comment requires repository access."

const COMMENT_POST_ATTEMPTS = 3
const REVIEW_RUN_MAX_ATTEMPTS = 3

class ReviewExecutionError extends Error {
  override name = "ReviewExecutionError"

  constructor(error: unknown) {
    super(errorMessage(error), { cause: error })
  }
}

type ReviewMentionComment = {
  authorLogin?: string
  body: string
  id: string
}

type ReviewDispatchPayload = {
  action: string
  comment?: ReviewMentionComment
  pr?: ReviewPullRequestContext
  prNumber?: number
  repoUrl: string
}

type ReviewRunPayload = {
  action?: string
  comment?: ReviewMentionComment
  manual: boolean
  pr?: ReviewPullRequestContext
  prNumber?: number
  reviewId: Id<"reviews">
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Review run failed."
}

/** Best-effort context for re-reviews and mentions: the previous report,
 * the PR discussion, and the commit list. A failure here degrades to a
 * from-scratch review instead of blocking the run. */
async function rerunContextForReview({
  client,
  comment,
  number,
  repo,
  reviewId,
  token,
}: {
  client: ReturnType<typeof workerConvexClient>
  comment?: ReviewMentionComment
  number: number
  repo: GitHubRepo
  reviewId: Id<"reviews">
  token: string
}): Promise<string | undefined> {
  try {
    const [previous, conversation, commits] = await Promise.all([
      client.query(api.reviews.workerGetLatestRunForPr, {
        prNumber: number,
        reviewId,
        workerSecret: getWorkerSecret(),
      }),
      getPullRequestConversation({ number, repo, token }),
      getPullRequestCommits({ number, repo, token }),
    ])
    const previousReport = previous?.content
      ? reviewReportFromContent(previous.content)
      : undefined

    const context = buildReviewRerunContext({
      commits: commits.map((commit) => ({
        authorLogin: commit.authorLogin,
        sha: commit.sha,
        subject: commit.subject,
      })),
      // Bot comments (including this app's own posted reports) add noise the
      // previous-report section already covers.
      conversation: conversation
        .filter((item) => !item.authorLogin?.endsWith("[bot]"))
        .map((item) => ({
          authorLogin: item.authorLogin,
          body: item.body,
          kind: item.kind,
        })),
      mention: comment
        ? { authorLogin: comment.authorLogin, body: comment.body }
        : undefined,
      previousHeadSha: previous?.prHeadSha,
      previousReport: previousReport || undefined,
    })

    return context || undefined
  } catch (error) {
    console.warn("Unable to assemble re-review context.", error)
    return undefined
  }
}

/** A pending "review requested" entry must not outlive a run that will never
 * submit a review. The badge is shared, per-login PR state though: when a
 * sibling run (a newer head SHA, or another review config on the repository)
 * is still underway, it stays — that run resolves it with its own submission.
 * Reuses the caller's token when one is in scope and mints otherwise, because
 * the run can outlive the ~1h token it started with. Best-effort — the stale
 * badge is cosmetic and never worth failing the task over. */
async function withdrawReviewRequest({
  client,
  excludeRunId,
  prNumber,
  repo,
  repoUrl,
  token,
  userId,
}: {
  client: ReturnType<typeof workerConvexClient>
  excludeRunId: Id<"codexRuns">
  prNumber: number
  repo: GitHubRepo
  repoUrl: string
  token?: string
  userId: Id<"users">
}) {
  const botLogin = cloudcodeBotLogin()
  if (!botLogin) return
  try {
    const hasActiveSibling = await client.query(
      api.reviews.workerHasActiveRunForPr,
      {
        excludeRunId,
        prNumber,
        repoUrl,
        workerSecret: getWorkerSecret(),
      }
    )
    if (hasActiveSibling) return

    const withdrawToken =
      token ??
      (await createWorkerGitHubRepoCredential(client, { repoUrl, userId }))
        ?.token
    if (!withdrawToken) return
    await removePullRequestReviewers({
      number: prNumber,
      repo,
      reviewers: [botLogin],
      token: withdrawToken,
    })
  } catch (error) {
    console.warn("Unable to withdraw the review request.", error)
  }
}

function reviewThreadUrl(threadId: Id<"threads">) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")
  return appUrl ? `${appUrl}/?thread=${threadId}` : undefined
}

/** The commit-status row this review owns in the PR merge box ("Review in
 * progress" → outcome). Config-named so multiple review configs on one
 * repository do not overwrite each other's row. */
function reviewStatusContext(reviewName: string) {
  return `Cloudcode review — ${reviewName}`
}

/** Best-effort commit-status update: a declined status (e.g. the app's
 * "Commit statuses: write" permission is not granted yet) only leaves a
 * breadcrumb and never affects the run. */
async function setReviewCommitStatus(
  input: Parameters<typeof setCommitStatus>[0]
) {
  try {
    const status = await setCommitStatus(input)
    if (!status.ok) {
      console.warn(
        `GitHub declined the "${input.state}" commit status: ${status.message}`
      )
    }
  } catch (error) {
    console.warn("Unable to set the review commit status.", error)
  }
}

/** The assistant message interleaves progress narration with encoded
 * <codex-tool> markers the chat UI renders as command chips; GitHub strips
 * the tags and shows the raw payloads. The PR comment wants only the final
 * report, so extract the text after the last tool marker. */
function reviewReportFromContent(content: string) {
  return finalRunMessageFromContent(content).trim()
}

// Fans one verified pull_request webhook event out to every enabled review
// config on the repository. Kept separate from review-run so the webhook
// route answers fast and per-config work is isolated and idempotent.
export const reviewDispatch = task({
  id: "review-dispatch",
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: ReviewDispatchPayload) => {
    const client = workerConvexClient()
    const workerSecret = getWorkerSecret()

    const reviews = await client.query(
      api.reviews.listEnabledForRepoForWorker,
      {
        repoUrl: payload.repoUrl,
        workerSecret,
      }
    )

    const isMention = payload.action === "mention"
    let dispatched = 0
    for (const review of reviews) {
      if (
        payload.action === "ready_for_review" &&
        !review.reviewReadyForReview
      ) {
        continue
      }
      if (payload.action === "synchronize" && !review.reviewOnPush) {
        continue
      }
      // A mention is an explicit request by a collaborator, so the author
      // filter does not apply to it.
      if (
        !isMention &&
        !reviewAllowsAuthor(
          review.authorFilterMode,
          review.authorFilters,
          payload.pr?.authorLogin
        )
      ) {
        continue
      }
      try {
        await tasks.trigger<typeof reviewRun>(
          "review-run",
          {
            action: payload.action,
            comment: payload.comment,
            // Mentions run like manual requests: the PR is loaded by number
            // and the head-SHA dedup does not apply.
            manual: isMention,
            pr: payload.pr,
            prNumber: payload.prNumber,
            reviewId: review._id,
          },
          {
            // One review per config per head commit (or per mention comment),
            // even when GitHub redelivers the webhook or sends opened +
            // ready_for_review back to back.
            idempotencyKey: isMention
              ? `review:${review._id}:comment:${payload.comment?.id}`
              : `review:${review._id}:${payload.pr?.number}:${payload.pr?.headSha}`,
            tags: [`user:${review.userId}`, `review:${review._id}`],
          }
        )
        dispatched += 1
      } catch (error) {
        await client
          .mutation(api.reviews.recordDispatchFailureForWorker, {
            error: errorMessage(error),
            reviewId: review._id,
            workerSecret,
          })
          .catch((recordError) => {
            console.warn("Unable to record dispatch failure.", recordError)
          })
      }
    }

    return { dispatched, matched: reviews.length }
  },
})

// Runs one review: guards (enabled, billing), headless GitHub token mint, run
// + thread creation in Convex, the regular cloudcode-run pipeline, and then
// submits the report as a formal pull request review. While the run is
// underway the app is listed as a requested reviewer.
export const reviewRun = task({
  catchError: ({ error }: { error: unknown }) =>
    error instanceof ReviewExecutionError ? { skipRetrying: true } : undefined,
  id: "review-run",
  retry: {
    factor: 2,
    maxAttempts: REVIEW_RUN_MAX_ATTEMPTS,
    maxTimeoutInMs: 10_000,
    minTimeoutInMs: 1_000,
    randomize: true,
  },
  run: async (payload: ReviewRunPayload, { ctx }) => {
    const client = workerConvexClient()
    const workerSecret = getWorkerSecret()

    const recordDispatchFailure = async (error: string) => {
      await client
        .mutation(api.reviews.recordDispatchFailureForWorker, {
          error,
          reviewId: payload.reviewId,
          workerSecret,
        })
        .catch((recordError) => {
          console.warn("Unable to record dispatch failure.", recordError)
        })
    }

    const review = await client.query(api.reviews.getForWorker, {
      reviewId: payload.reviewId,
      workerSecret,
    })
    if (!review) return { dispatched: false, reason: "not_found" as const }
    if (!review.enabled && !payload.manual) {
      return { dispatched: false, reason: "disabled" as const }
    }
    // Manual runs name one specific PR, so they bypass the author filter.
    if (
      !payload.manual &&
      !reviewAllowsAuthor(
        review.authorFilterMode,
        review.authorFilters,
        payload.pr?.authorLogin
      )
    ) {
      return { dispatched: false, reason: "author_filtered" as const }
    }

    const repo = parseGitHubRepoUrl(review.repoUrl)
    if (!repo) {
      await recordDispatchFailure("Review repository is not a GitHub URL.")
      return { dispatched: false, reason: "invalid_repo" as const }
    }
    const statusContext = reviewStatusContext(review.name)

    let created: {
      resumed: boolean
      runId: Id<"codexRuns">
      threadId: Id<"threads">
      userId: Id<"users">
    }
    let pr: ReviewPullRequestContext
    try {
      const billing = await client.action(
        api.billing.checkInfraAccessForWorker,
        {
          userId: review.userId,
          workerSecret,
        }
      )
      if (!billing.allowed) {
        await recordDispatchFailure(BILLING_EXHAUSTED_ERROR)
        return { dispatched: false, reason: "billing_exhausted" as const }
      }

      // Unlike automations, a credential is required: posting the comment is
      // the point of the feature, and installation tokens are also what let
      // us fetch refs/pull/<n>/head on private repositories.
      const credential = await createWorkerGitHubRepoCredential(client, {
        repoUrl: review.repoUrl,
        userId: review.userId,
      })
      if (!credential?.token) {
        await recordDispatchFailure(GITHUB_ACCESS_ERROR)
        return { dispatched: false, reason: "github_access" as const }
      }

      // Manual runs arrive with just a PR number; load the rest from GitHub.
      let prContext = payload.pr
      if (!prContext) {
        if (!payload.prNumber) {
          await recordDispatchFailure("prNumber is required for manual runs.")
          return { dispatched: false, reason: "missing_pr" as const }
        }
        const summary = await getPullRequest({
          number: payload.prNumber,
          repo,
          token: credential.token,
        })
        if (!summary) {
          await recordDispatchFailure(
            `Pull request #${payload.prNumber} was not found on ${review.repoUrl}.`
          )
          return { dispatched: false, reason: "pr_not_found" as const }
        }
        prContext = {
          authorLogin: summary.authorLogin,
          baseRef: summary.baseRef,
          body: summary.body,
          crossFork: summary.crossFork,
          headRef: summary.headRef,
          headSha: summary.headSha,
          htmlUrl: summary.htmlUrl,
          number: summary.number,
          title: summary.title,
        }
      }

      // The webhook parser needs dispatch-only fields such as `draft`, while
      // Convex validates an exact object shape. Normalize here as a second
      // boundary guard so rolling or out-of-order deployments remain safe.
      pr = normalizeReviewPullRequestContext(prContext)

      // Re-reviews (new commits) and mentions carry the PR's history so the
      // agent can confirm resolved findings and honor the request.
      const additionalContext =
        payload.action === "synchronize" || payload.action === "mention"
          ? await rerunContextForReview({
              client,
              comment: payload.comment,
              number: pr.number,
              repo,
              reviewId: payload.reviewId,
              token: credential.token,
            })
          : undefined

      const result = await client.mutation(api.reviews.workerCreateRun, {
        additionalContext,
        githubToken: encryptSecret(credential.token),
        githubUserEmail: credential.gitUserEmail,
        githubUserName: credential.gitUserName,
        githubUsername: credential.username ?? undefined,
        manual: payload.manual,
        notesAccessToken: randomUUID(),
        pr,
        reviewId: payload.reviewId,
        requestKey: ctx.run.id,
        workerSecret,
      })
      if (!result.ok) {
        if (result.status === "duplicate") {
          return { dispatched: false, reason: "duplicate" as const }
        }
        if (
          result.status === "missing_auth" ||
          result.status === "auth_reconnect_required"
        ) {
          await client
            .mutation(api.reviews.disableForWorker, {
              reason: result.message,
              reviewId: payload.reviewId,
              workerSecret,
            })
            .catch((disableError) => {
              console.warn("Unable to disable review.", disableError)
            })
          return { dispatched: false, reason: result.status }
        }
        return { dispatched: false, reason: result.status }
      }
      created = result

      if (!created.resumed) {
        // Three independent best-effort signals, in parallel: 👀 on GitHub
        // the moment the review is actually underway (on the triggering
        // comment for mentions, on the PR itself otherwise), the app
        // requested as a reviewer so the PR shows a pending "review
        // requested" entry that the submitted review later resolves, and a
        // pending commit status so the merge box's checks list shows
        // "Review in progress". GitHub refuses the reviewer request on PRs
        // the app itself authored; rejections leave a breadcrumb, or a
        // persistently refusing repo would be undiagnosable.
        const botLogin = cloudcodeBotLogin()
        await Promise.all([
          setReviewCommitStatus({
            context: statusContext,
            description: "Review in progress",
            repo,
            sha: pr.headSha,
            state: "pending",
            targetUrl: reviewThreadUrl(created.threadId),
            token: credential.token,
          }),
          (payload.comment
            ? addIssueCommentReaction({
                commentId: payload.comment.id,
                content: "eyes",
                repo,
                token: credential.token,
              })
            : addPullRequestReaction({
                content: "eyes",
                number: pr.number,
                repo,
                token: credential.token,
              })
          ).catch((reactionError) => {
            console.warn("Unable to add the eyes reaction.", reactionError)
          }),
          botLogin
            ? requestPullRequestReviewers({
                number: pr.number,
                repo,
                reviewers: [botLogin],
                token: credential.token,
              })
                .then((requested) => {
                  if (!requested.ok) {
                    console.warn(
                      `GitHub declined the reviewer request on PR #${pr.number}: ${requested.message}`
                    )
                  }
                })
                .catch((requestError) => {
                  console.warn("Unable to request the review.", requestError)
                })
            : null,
        ])
      }
    } catch (error) {
      // Setup and control-plane errors are safe to retry. Only count the
      // terminal attempt so one transient outage cannot auto-disable a review.
      if (ctx.attempt.number >= REVIEW_RUN_MAX_ATTEMPTS) {
        await recordDispatchFailure(errorMessage(error))
      }
      throw error
    }

    // Everything below runs under one reconciliation boundary for the two
    // pieces of shared PR state this run owns: the requested-reviewer badge
    // (a submitted review resolves it on GitHub's side; every other terminal
    // exit withdraws it) and the "Review in progress" commit-status row
    // (flipped to success/error on the terminal exit). A retryable throw
    // leaves both alone, because the next attempt still reviews.
    let postToken: string | undefined
    let retrying = false
    let reviewSubmitted = false
    let statusOutcome:
      | { description: string; state: "error" | "success"; targetUrl?: string }
      | undefined
    try {
      let outcome = created.resumed
        ? await client.query(api.reviews.workerGetRunOutcome, {
            runId: created.runId,
            workerSecret,
          })
        : null
      if (outcome?.reviewCommentUrl) {
        // A previous attempt already posted. A formal review resolved the
        // pending request; a fallback comment did not, so let the finally
        // reconcile based on which kind of URL was recorded.
        reviewSubmitted = outcome.reviewCommentUrl.includes(
          "#pullrequestreview-"
        )
        statusOutcome = {
          description: "Review posted.",
          state: "success",
          targetUrl: outcome.reviewCommentUrl,
        }
        return {
          dispatched: true,
          commented: true,
          commentUrl: outcome.reviewCommentUrl,
          runId: created.runId,
        }
      }

      // From here the run and its pending assistant message exist; failures
      // must unwind through failWorkerRun so the thread is not left pending.
      if (outcome?.status !== "succeeded") {
        try {
          await tasks.triggerAndWait<typeof cloudcodeRun>(
            "cloudcode-run",
            { runId: created.runId },
            {
              idempotencyKey: created.runId,
              tags: [`user:${created.userId}`, `review:${payload.reviewId}`],
            }
          )
        } catch (error) {
          await failWorkerRun(client, created.runId, errorMessage(error)).catch(
            (failError) => {
              console.warn("Unable to mark review run failed.", failError)
            }
          )
          // Retrying an agent execution can spend another sandbox run and
          // make side effects unpredictable. The child task owns its own
          // retries.
          throw new ReviewExecutionError(error)
        }
      }

      // Convex is the source of truth for the outcome: cloudcode-run records
      // success/failure/cancellation there through the shared worker
      // mutations.
      outcome = await client.query(api.reviews.workerGetRunOutcome, {
        runId: created.runId,
        workerSecret,
      })
      if (!outcome || outcome.status !== "succeeded") {
        statusOutcome = {
          description:
            outcome?.status === "canceled"
              ? "Review canceled."
              : "Review failed.",
          state: "error",
        }
        return {
          dispatched: true,
          commented: false,
          runId: created.runId,
          runStatus: outcome?.status,
        }
      }
      const report = reviewReportFromContent(outcome.content)
      if (!report || !outcome.prNumber) {
        statusOutcome = {
          description: "Review finished without a report to post.",
          state: "error",
        }
        await client
          .mutation(api.reviews.workerRecordCommentFailure, {
            error: "Review finished without a report to post.",
            reviewId: payload.reviewId,
            workerSecret,
          })
          .catch((recordError) => {
            console.warn("Unable to record comment failure.", recordError)
          })
        return { dispatched: true, commented: false, runId: created.runId }
      }

      const threadUrl = reviewThreadUrl(created.threadId)
      const footerLink = threadUrl
        ? `[Open the review thread](${threadUrl})`
        : "Review thread available in Cloudcode."
      const commentBody = `${report}\n\n---\n_Reviewed by Cloudcode · ${footerLink}_`
      const prNumber = outcome.prNumber

      // The run can outlive the ~1h installation token it started with, so
      // posting mints fresh ones.
      const mintPostToken = async () => {
        const credential = await createWorkerGitHubRepoCredential(client, {
          repoUrl: review.repoUrl,
          userId: review.userId,
        })
        if (!credential?.token) throw new Error(GITHUB_ACCESS_ERROR)
        postToken = credential.token
        return postToken
      }

      // Posting is not idempotent, so each attempt posts at most once, and
      // deterministic GitHub rejections (4xx) fail fast — retrying cannot
      // change them.
      const postWithRetries = async (
        post: (token: string) => Promise<{ htmlUrl?: string }>
      ): Promise<{ htmlUrl?: string } | { postError: unknown }> => {
        let lastError: unknown
        for (let attempt = 1; attempt <= COMMENT_POST_ATTEMPTS; attempt += 1) {
          try {
            return await post(await mintPostToken())
          } catch (error) {
            lastError = error
            if (error instanceof GitHubApiError && error.status < 500) break
            if (attempt < COMMENT_POST_ATTEMPTS) {
              await new Promise((resolve) =>
                setTimeout(resolve, attempt * 5_000)
              )
            }
          }
        }
        return { postError: lastError }
      }

      // A formal review submission (not an issue comment) so the app lands
      // in the PR's Reviewers list and resolves its pending review request.
      let posted = await postWithRetries((token) =>
        createPullRequestReview({
          body: commentBody,
          number: prNumber,
          repo,
          token,
        })
      )
      let reviewError: unknown
      if ("postError" in posted) {
        reviewError = posted.postError
        // GitHub can refuse review submissions in cases where a plain
        // comment is still accepted (e.g. the app authored the PR). The
        // report must not be lost, so degrade to the conversation thread.
        posted = await postWithRetries((token) =>
          createIssueComment({
            body: commentBody,
            number: prNumber,
            repo,
            token,
          })
        )
      } else {
        reviewSubmitted = true
      }

      if ("postError" in posted) {
        // The report still lives in the thread, but a review that never
        // posts is a broken setup — count it toward the auto-disable failure
        // streak, naming both blockers so neither hides the other.
        statusOutcome = {
          description: "Unable to post the review report.",
          state: "error",
        }
        await client
          .mutation(api.reviews.workerRecordCommentFailure, {
            error: `Unable to post the PR review: ${errorMessage(reviewError)} The fallback comment also failed: ${errorMessage(posted.postError)}`,
            reviewId: payload.reviewId,
            workerSecret,
          })
          .catch((recordError) => {
            console.warn("Unable to record comment failure.", recordError)
          })
        return { dispatched: true, commented: false, runId: created.runId }
      }

      // The report is live on GitHub from here: recording its URL retries on
      // its own, and a record failure must never re-post the review or count
      // toward the failure streak. The status row surfaces the report's own
      // confidence verdict when it has one.
      const commentUrl = posted.htmlUrl
      statusOutcome = {
        description:
          report.match(/^Confidence to merge:.*$/im)?.[0]?.trim() ??
          "Review posted.",
        state: "success",
        targetUrl: commentUrl ?? pr.htmlUrl,
      }
      for (let attempt = 1; attempt <= COMMENT_POST_ATTEMPTS; attempt += 1) {
        try {
          await client.mutation(api.reviews.workerRecordCommentPosted, {
            commentUrl: commentUrl ?? "",
            runId: created.runId,
            workerSecret,
          })
          break
        } catch (recordError) {
          if (attempt < COMMENT_POST_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 1_000))
          } else {
            console.warn("Unable to record the posted review URL.", recordError)
          }
        }
      }

      return {
        dispatched: true,
        commented: true,
        commentUrl,
        runId: created.runId,
      }
    } catch (error) {
      retrying =
        !(error instanceof ReviewExecutionError) &&
        ctx.attempt.number < REVIEW_RUN_MAX_ATTEMPTS
      statusOutcome ??= { description: errorMessage(error), state: "error" }
      throw error
    } finally {
      if (!retrying) {
        // One token serves the status row and the badge withdrawal; mint only
        // when the posting phase never did.
        let finalizeToken = postToken
        if (!finalizeToken) {
          const credential = await createWorkerGitHubRepoCredential(client, {
            repoUrl: review.repoUrl,
            userId: review.userId,
          }).catch(() => null)
          finalizeToken = credential?.token
        }
        if (finalizeToken) {
          await setReviewCommitStatus({
            context: statusContext,
            repo,
            sha: pr.headSha,
            token: finalizeToken,
            ...(statusOutcome ?? {
              description: "Review failed.",
              state: "error" as const,
            }),
          })
        }
        if (!reviewSubmitted) {
          await withdrawReviewRequest({
            client,
            excludeRunId: created.runId,
            prNumber: pr.number,
            repo,
            repoUrl: review.repoUrl,
            token: finalizeToken,
            userId: review.userId,
          })
        }
      }
    }
  },
})
