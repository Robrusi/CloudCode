import assert from "node:assert/strict"

import { parsePullRequestWebhookEvent } from "../lib/github/webhook"
import {
  normalizeReviewPullRequestContext,
  reviewPullRequestContextValidator,
} from "../lib/reviews/pull-request"

function pullRequestWebhookPayload(draft: boolean) {
  return {
    action: "opened",
    pull_request: {
      base: {
        ref: "main",
        repo: { full_name: "Robrusi/CloudCode" },
      },
      body: "Review this change.",
      draft,
      head: {
        ref: "agent/review-fix",
        repo: { full_name: "Robrusi/CloudCode" },
        sha: "0123456789abcdef",
      },
      html_url: "https://github.com/Robrusi/CloudCode/pull/18",
      number: 18,
      title: "Fix automatic reviews",
      user: { login: "Robrusi" },
    },
    repository: { full_name: "Robrusi/CloudCode" },
    sender: { login: "Robrusi" },
  }
}

const validatorFields = Object.keys(
  reviewPullRequestContextValidator.fields
).sort()

for (const draft of [true, false]) {
  const parsed = parsePullRequestWebhookEvent(pullRequestWebhookPayload(draft))
  assert.ok(parsed)
  assert.equal(parsed.pr.draft, draft)

  const normalized = normalizeReviewPullRequestContext(parsed.pr)
  assert.deepEqual(Object.keys(normalized).sort(), validatorFields)
  assert.equal("draft" in normalized, false)
  assert.deepEqual(normalized, {
    authorLogin: "Robrusi",
    baseRef: "main",
    body: "Review this change.",
    crossFork: false,
    headRef: "agent/review-fix",
    headSha: "0123456789abcdef",
    htmlUrl: "https://github.com/Robrusi/CloudCode/pull/18",
    number: 18,
    title: "Fix automatic reviews",
  })
}

console.log("Review webhook payload checks passed.")
