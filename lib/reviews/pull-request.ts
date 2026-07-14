import { v, type Infer } from "convex/values"

/** The exact pull-request shape accepted by review workers and Convex.
 * Webhook and GitHub API responses contain additional fields, so normalize at
 * each process boundary before forwarding this context. */
export const reviewPullRequestContextValidator = v.object({
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

export type ReviewPullRequestContext = Infer<
  typeof reviewPullRequestContextValidator
>

/** Returns a new object containing only the fields accepted by the shared
 * validator. This is intentionally explicit: Convex object validators reject
 * extra properties, even when TypeScript structurally accepts a wider object. */
export function normalizeReviewPullRequestContext(
  pr: ReviewPullRequestContext
): ReviewPullRequestContext {
  return {
    authorLogin: pr.authorLogin,
    baseRef: pr.baseRef,
    body: pr.body,
    crossFork: pr.crossFork,
    headRef: pr.headRef,
    headSha: pr.headSha,
    htmlUrl: pr.htmlUrl,
    number: pr.number,
    title: pr.title,
  }
}
