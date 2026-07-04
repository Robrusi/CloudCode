import { task, tasks } from "@trigger.dev/sdk"
import { randomUUID } from "node:crypto"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  failWorkerRun,
  getWorkerSecret,
  workerConvexClient,
} from "@/lib/codex/run-worker"
import { createWorkerGitHubRepoCredential } from "@/lib/github/app-worker"
import { createIssueComment, getPullRequest } from "@/lib/github/pull-requests"
import { parseGitHubRepoUrl } from "@/lib/github/repo"
import { reviewAllowsAuthor } from "@/lib/reviews/config"
import type { ReviewPullRequestContext } from "@/lib/reviews/prompt"
import { encryptSecret } from "@/lib/security/secret-crypto"
import type { cloudcodeRun } from "@/trigger/cloudcode-run"

const BILLING_EXHAUSTED_ERROR =
  "Infrastructure usage is exhausted. Upgrade to Hobby or Plus, or wait for your included usage to reset."
const GITHUB_ACCESS_ERROR =
  "Install the GitHub App on this repository and authorize your GitHub user; posting the review comment requires repository access."

const COMMENT_POST_ATTEMPTS = 3

type ReviewDispatchPayload = {
  action: string
  pr: ReviewPullRequestContext
  repoUrl: string
}

type ReviewRunPayload = {
  action?: string
  manual: boolean
  pr?: ReviewPullRequestContext
  prNumber?: number
  reviewId: Id<"reviews">
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Review run failed."
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

    let dispatched = 0
    for (const review of reviews) {
      if (
        payload.action === "ready_for_review" &&
        !review.reviewReadyForReview
      ) {
        continue
      }
      if (
        !reviewAllowsAuthor(
          review.authorFilterMode,
          review.authorFilters,
          payload.pr.authorLogin
        )
      ) {
        continue
      }
      try {
        await tasks.trigger<typeof reviewRun>(
          "review-run",
          {
            action: payload.action,
            manual: false,
            pr: payload.pr,
            reviewId: review._id,
          },
          {
            // One review per config per head commit, even when GitHub
            // redelivers the webhook or sends opened + ready_for_review.
            idempotencyKey: `review:${review._id}:${payload.pr.number}:${payload.pr.headSha}`,
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
// posts the report as a comment on the pull request.
export const reviewRun = task({
  id: "review-run",
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: ReviewRunPayload) => {
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

    let created: {
      runId: Id<"codexRuns">
      threadId: Id<"threads">
      userId: Id<"users">
    }
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
      let pr = payload.pr
      if (!pr) {
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
        pr = {
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

      const result = await client.mutation(api.reviews.workerCreateRun, {
        githubToken: encryptSecret(credential.token),
        githubUserEmail: credential.gitUserEmail,
        githubUserName: credential.gitUserName,
        githubUsername: credential.username ?? undefined,
        manual: payload.manual,
        notesAccessToken: randomUUID(),
        pr,
        reviewId: payload.reviewId,
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
    } catch (error) {
      await recordDispatchFailure(errorMessage(error))
      throw error
    }

    // From here the run and its pending assistant message exist; failures
    // must unwind through failWorkerRun so the thread is not left pending.
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
      throw error
    }

    // Convex is the source of truth for the outcome: cloudcode-run records
    // success/failure/cancellation there through the shared worker mutations.
    const outcome = await client.query(api.reviews.workerGetRunOutcome, {
      runId: created.runId,
      workerSecret,
    })
    if (!outcome || outcome.status !== "succeeded") {
      return {
        dispatched: true,
        commented: false,
        runId: created.runId,
        runStatus: outcome?.status,
      }
    }
    if (!outcome.content.trim() || !outcome.prNumber) {
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

    // The run can outlive the ~1h installation token, so mint a fresh one
    // for the comment.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")
    const footerLink = appUrl
      ? `[Open the review thread](${appUrl}/?thread=${created.threadId})`
      : "Review thread available in Cloudcode."
    const commentBody = `${outcome.content.trim()}\n\n---\n_Reviewed by Cloudcode · ${footerLink}_`

    let lastError: unknown
    for (let attempt = 1; attempt <= COMMENT_POST_ATTEMPTS; attempt += 1) {
      try {
        const credential = await createWorkerGitHubRepoCredential(client, {
          repoUrl: review.repoUrl,
          userId: review.userId,
        })
        if (!credential?.token) throw new Error(GITHUB_ACCESS_ERROR)

        const comment = await createIssueComment({
          body: commentBody,
          number: outcome.prNumber,
          repo,
          token: credential.token,
        })
        await client.mutation(api.reviews.workerRecordCommentPosted, {
          commentUrl: comment.htmlUrl ?? "",
          runId: created.runId,
          workerSecret,
        })

        return {
          dispatched: true,
          commented: true,
          commentUrl: comment.htmlUrl,
          runId: created.runId,
        }
      } catch (error) {
        lastError = error
        if (attempt < COMMENT_POST_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 5_000))
        }
      }
    }

    // The report still lives in the thread, but a review that never posts is
    // a broken setup — count it toward the auto-disable failure streak.
    await client
      .mutation(api.reviews.workerRecordCommentFailure, {
        error: `Unable to post the PR comment: ${errorMessage(lastError)}`,
        reviewId: payload.reviewId,
        workerSecret,
      })
      .catch((recordError) => {
        console.warn("Unable to record comment failure.", recordError)
      })

    return { dispatched: true, commented: false, runId: created.runId }
  },
})
