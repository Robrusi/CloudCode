import { createHmac, timingSafeEqual } from "node:crypto"

import { canonicalGitHubRepoUrl } from "@/lib/github/repo"
import type { ReviewPullRequestContext } from "@/lib/reviews/prompt"

export function isGitHubWebhookConfigured() {
  return Boolean(process.env.GITHUB_APP_WEBHOOK_SECRET)
}

/** GitHub signs the raw body with HMAC-SHA256 and sends it as
 * `X-Hub-Signature-256: sha256=<hex>`; this signature is the webhook's only
 * authentication, so compare timing-safe. */
export function verifyGitHubWebhookSignature(
  rawBody: string,
  signatureHeader: string | null
) {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET
  if (!secret || !signatureHeader) return false

  const expected = `sha256=${createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex")}`
  const actualBuffer = Buffer.from(signatureHeader)
  const expectedBuffer = Buffer.from(expected)

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

export type PullRequestWebhookEvent = {
  action: string
  pr: ReviewPullRequestContext & { draft: boolean }
  repoFullName: string
  repoUrl: string
}

type PullRequestWebhookPayload = {
  action?: unknown
  pull_request?: {
    base?: { ref?: unknown; repo?: { full_name?: unknown } | null } | null
    body?: unknown
    draft?: unknown
    head?: {
      ref?: unknown
      repo?: { full_name?: unknown } | null
      sha?: unknown
    } | null
    html_url?: unknown
    number?: unknown
    title?: unknown
    user?: { login?: unknown } | null
  } | null
  repository?: { full_name?: unknown } | null
}

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function parsePullRequestWebhookEvent(
  payload: unknown
): PullRequestWebhookEvent | null {
  if (!payload || typeof payload !== "object") return null
  const {
    action,
    pull_request: pr,
    repository,
  } = payload as PullRequestWebhookPayload

  const parsedAction = requiredString(action)
  const repoFullName = requiredString(repository?.full_name)
  if (!pr) return null
  const number = typeof pr.number === "number" ? pr.number : undefined
  const title = requiredString(pr.title)
  const htmlUrl = requiredString(pr.html_url)
  const baseRef = requiredString(pr.base?.ref)
  const headRef = requiredString(pr.head?.ref)
  const headSha = requiredString(pr.head?.sha)
  if (
    !parsedAction ||
    !repoFullName ||
    !number ||
    !title ||
    !htmlUrl ||
    !baseRef ||
    !headRef ||
    !headSha
  ) {
    return null
  }

  const repoUrl = canonicalGitHubRepoUrl(repoFullName)
  if (!repoUrl) return null

  // A missing head repo means the fork was deleted; treat it as cross-fork so
  // the run never assumes the head branch lives on the base repository.
  const headRepoName = requiredString(pr.head?.repo?.full_name)
  const baseRepoName = requiredString(pr.base?.repo?.full_name)

  return {
    action: parsedAction,
    pr: {
      authorLogin: requiredString(pr.user?.login),
      baseRef,
      body: typeof pr.body === "string" ? pr.body : undefined,
      crossFork: !headRepoName || headRepoName !== baseRepoName,
      draft: pr.draft === true,
      headRef,
      headSha,
      htmlUrl,
      number,
      title,
    },
    repoFullName,
    repoUrl,
  }
}
