import { githubApiHeaders, githubRepoApiUrl } from "@/lib/github/repo-api"
import type { GitHubRepo } from "@/lib/github/repo"

export type PullRequestState = "open" | "closed"

export type PullRequestSummary = {
  authorAvatarUrl?: string
  authorLogin?: string
  baseRef: string
  body?: string
  crossFork: boolean
  draft: boolean
  headRef: string
  headSha: string
  htmlUrl: string
  mergeable: boolean | null
  mergeableState: string | null
  merged: boolean
  number: number
  state: PullRequestState
  title: string
}

export type CheckConclusion =
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "skipped"
  | "stale"
  | "success"
  | "timed_out"
  | null

export type NormalizedCheck = {
  conclusion: CheckConclusion
  detailsUrl?: string
  id: string
  name: string
  status: string
}

export type ChecksSummary = {
  checks: NormalizedCheck[]
  failing: number
  pending: number
  succeeded: number
  total: number
}

export type MergeMethod = "merge" | "rebase" | "squash"

export type PullRequestReviewState =
  | "approved"
  | "changes_requested"
  | "commented"
  | "dismissed"
  | "pending"

export type PullRequestReviewSummary = {
  authorAvatarUrl?: string
  authorLogin?: string
  body?: string
  htmlUrl?: string
  id: string
  state: PullRequestReviewState
  submittedAt: number | null
}

export type PullRequestTimelineItem = {
  authorAvatarUrl?: string
  authorLogin?: string
  body?: string
  htmlUrl?: string
  id: string
  kind: "comment" | "review" | "review-comment"
  /** File the comment is anchored to; review-comment only. */
  path?: string
  /** Review verdict; review only. */
  reviewState?: PullRequestReviewState
  timestamp: number | null
}

export type PullRequestCommit = {
  additions: number
  authorAvatarUrl?: string
  authorLogin?: string
  authorName: string | null
  deletions: number
  filesChanged: number
  htmlUrl?: string
  sha: string
  shortSha: string
  subject: string
  timestamp: number | null
}

export type CreatePullRequestResult =
  | { compareUrl: string; kind: "manual" }
  | { kind: "created"; pr: PullRequestSummary }

const FAILING_CONCLUSIONS = new Set<CheckConclusion>([
  "action_required",
  "cancelled",
  "failure",
  "stale",
  "timed_out",
])

type GitHubPullResponse = {
  base?: { ref?: unknown; repo?: { full_name?: unknown } | null } | null
  body?: unknown
  draft?: unknown
  head?: {
    ref?: unknown
    repo?: { full_name?: unknown } | null
    sha?: unknown
  } | null
  html_url?: unknown
  mergeable?: unknown
  mergeable_state?: unknown
  merged?: unknown
  merged_at?: unknown
  number?: unknown
  state?: unknown
  title?: unknown
  user?: { avatar_url?: unknown; login?: unknown } | null
}

type GitHubCheckRunsResponse = {
  check_runs?: Array<{
    conclusion?: unknown
    details_url?: unknown
    id?: unknown
    name?: unknown
    status?: unknown
  }>
}

type GitHubCommitStatusResponse = {
  statuses?: Array<{
    context?: unknown
    state?: unknown
    target_url?: unknown
  }>
}

type GitHubReviewResponse = {
  body?: unknown
  html_url?: unknown
  id?: unknown
  state?: unknown
  submitted_at?: unknown
  user?: { avatar_url?: unknown; login?: unknown } | null
}

type GitHubCommentResponse = {
  body?: unknown
  created_at?: unknown
  html_url?: unknown
  id?: unknown
  path?: unknown
  user?: { avatar_url?: unknown; login?: unknown } | null
}

type GitHubRepositoryMergeSettingsResponse = {
  allow_merge_commit?: unknown
  allow_rebase_merge?: unknown
  allow_squash_merge?: unknown
}

type GitHubFetchResult<T> = {
  data: T
  message: string
  ok: boolean
  status: number
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/** Thrown by write helpers when GitHub rejects a request. `status` lets
 * callers separate deterministic rejections (4xx — retrying cannot help)
 * from transient failures worth retrying. */
export class GitHubApiError extends Error {
  override name = "GitHubApiError"

  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function githubFetch<T>(
  url: string,
  token: string | undefined,
  init: RequestInit = {}
): Promise<GitHubFetchResult<T>> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...githubApiHeaders(token),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  })

  const text = await response.text()
  const data = text ? (JSON.parse(text) as T) : ({} as T)
  const message =
    typeof (data as { message?: unknown }).message === "string"
      ? (data as { message: string }).message
      : `GitHub request failed with status ${response.status}.`

  return { data, message, ok: response.ok, status: response.status }
}

function normalizePullRequest(
  data: GitHubPullResponse
): PullRequestSummary | null {
  const number = typeof data.number === "number" ? data.number : undefined
  const htmlUrl = optionalString(data.html_url)
  const headRef = optionalString(data.head?.ref)
  const headSha = optionalString(data.head?.sha)
  const baseRef = optionalString(data.base?.ref)

  if (!number || !htmlUrl || !headRef || !headSha || !baseRef) return null

  // A missing head repo means the fork was deleted; treat it as cross-fork so
  // callers never assume the head branch lives on the base repository.
  const headRepoName = optionalString(data.head?.repo?.full_name)
  const baseRepoName = optionalString(data.base?.repo?.full_name)

  return {
    authorAvatarUrl: optionalString(data.user?.avatar_url),
    authorLogin: optionalString(data.user?.login),
    baseRef,
    body: typeof data.body === "string" ? data.body : undefined,
    crossFork: !headRepoName || headRepoName !== baseRepoName,
    draft: data.draft === true,
    headRef,
    headSha,
    htmlUrl,
    mergeable: typeof data.mergeable === "boolean" ? data.mergeable : null,
    mergeableState: optionalString(data.mergeable_state) ?? null,
    merged: data.merged === true || typeof data.merged_at === "string",
    number,
    state: data.state === "closed" ? "closed" : "open",
    title: optionalString(data.title) ?? `#${number}`,
  }
}

function pullRequestRank(pr: PullRequestSummary) {
  if (pr.merged) return 2
  if (pr.state === "closed") return 3
  return pr.draft ? 1 : 0
}

// A branch can have several pull requests (e.g. a merged one plus a newly
// opened one, or open PRs against different base branches). Open, non-draft
// PRs are listed first, then drafts, then merged, then closed; ties break to
// the most recent. The list endpoint omits `mergeable`, so callers enrich open
// PRs via `getPullRequest`.
export async function findPullRequestsForBranch({
  branch,
  repo,
  token,
}: {
  branch: string
  repo: GitHubRepo
  token?: string
}): Promise<PullRequestSummary[]> {
  const url = `${githubRepoApiUrl(repo)}/pulls?head=${encodeURIComponent(
    `${repo.owner}:${branch}`
  )}&state=all&per_page=100`
  const result = await githubFetch<GitHubPullResponse[]>(url, token)

  if (!result.ok || !Array.isArray(result.data)) return []

  const summaries: PullRequestSummary[] = []
  for (const item of result.data) {
    const summary = normalizePullRequest(item)
    if (summary) summaries.push(summary)
  }

  return summaries.sort(
    (a, b) => pullRequestRank(a) - pullRequestRank(b) || b.number - a.number
  )
}

export async function getPullRequest({
  number,
  repo,
  token,
}: {
  number: number
  repo: GitHubRepo
  token?: string
}): Promise<PullRequestSummary | null> {
  const result = await githubFetch<GitHubPullResponse>(
    `${githubRepoApiUrl(repo)}/pulls/${number}`,
    token
  )
  if (!result.ok) return null
  return normalizePullRequest(result.data)
}

function commitStatusToCheck(status: {
  context?: unknown
  state?: unknown
  target_url?: unknown
}): NormalizedCheck | null {
  const name = optionalString(status.context)
  if (!name) return null
  const state = optionalString(status.state)

  const conclusion: CheckConclusion =
    state === "success"
      ? "success"
      : state === "failure" || state === "error"
        ? "failure"
        : null

  return {
    conclusion,
    detailsUrl: optionalString(status.target_url),
    id: `status:${name}`,
    name,
    status: state === "pending" || !state ? "in_progress" : "completed",
  }
}

export async function getCommitChecks({
  ref,
  repo,
  token,
}: {
  ref: string
  repo: GitHubRepo
  token?: string
}): Promise<ChecksSummary> {
  const base = githubRepoApiUrl(repo)
  const [runs, statuses] = await Promise.all([
    githubFetch<GitHubCheckRunsResponse>(
      `${base}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`,
      token
    ),
    githubFetch<GitHubCommitStatusResponse>(
      `${base}/commits/${encodeURIComponent(ref)}/status`,
      token
    ),
  ])

  const checks: NormalizedCheck[] = []

  if (runs.ok) {
    for (const run of runs.data.check_runs ?? []) {
      const name = optionalString(run.name)
      const id =
        typeof run.id === "number" || typeof run.id === "string"
          ? `run:${run.id}`
          : undefined
      if (!name || !id) continue
      const conclusion = optionalString(run.conclusion)
      checks.push({
        conclusion: (conclusion as CheckConclusion) ?? null,
        detailsUrl: optionalString(run.details_url),
        id,
        name,
        status: optionalString(run.status) ?? "completed",
      })
    }
  }

  if (statuses.ok) {
    for (const status of statuses.data.statuses ?? []) {
      const check = commitStatusToCheck(status)
      if (check) checks.push(check)
    }
  }

  let pending = 0
  let failing = 0
  let succeeded = 0
  for (const check of checks) {
    if (check.status !== "completed") {
      pending += 1
    } else if (check.conclusion === "success") {
      succeeded += 1
    } else if (FAILING_CONCLUSIONS.has(check.conclusion)) {
      failing += 1
    }
  }

  return { checks, failing, pending, succeeded, total: checks.length }
}

export type CommitStatusState = "error" | "failure" | "pending" | "success"

/** Sets a commit status on the SHA (the rows in the PR merge box's checks
 * list). Statuses are idempotent per `context`: posting again overwrites the
 * previous state for that context, which lets one context track a run's
 * pending → success/error lifecycle with no stored id. Requires the app's
 * "Commit statuses: write" permission; without it GitHub declines and the
 * message says so. */
export async function setCommitStatus({
  context,
  description,
  repo,
  sha,
  state,
  targetUrl,
  token,
}: {
  context: string
  description: string
  repo: GitHubRepo
  sha: string
  state: CommitStatusState
  targetUrl?: string
  token?: string
}): Promise<{ message: string; ok: boolean }> {
  const result = await githubFetch<unknown>(
    `${githubRepoApiUrl(repo)}/statuses/${encodeURIComponent(sha)}`,
    token,
    {
      body: JSON.stringify({
        context,
        // GitHub rejects descriptions over 140 characters.
        description: description.slice(0, 140),
        state,
        ...(targetUrl ? { target_url: targetUrl } : {}),
      }),
      method: "POST",
    }
  )
  return { message: result.message, ok: result.ok }
}

const REVIEW_STATES: Record<string, PullRequestReviewState> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "pending",
}

function normalizeReview(
  data: GitHubReviewResponse
): PullRequestReviewSummary | null {
  const id =
    typeof data.id === "number" || typeof data.id === "string"
      ? String(data.id)
      : undefined
  const state = REVIEW_STATES[optionalString(data.state) ?? ""]
  if (!id || !state) return null

  const submittedAtRaw = optionalString(data.submitted_at)
  const submittedAt = submittedAtRaw ? Date.parse(submittedAtRaw) : NaN

  return {
    authorAvatarUrl: optionalString(data.user?.avatar_url),
    authorLogin: optionalString(data.user?.login),
    body:
      typeof data.body === "string" && data.body.trim() ? data.body : undefined,
    htmlUrl: optionalString(data.html_url),
    id,
    state,
    submittedAt: Number.isFinite(submittedAt) ? submittedAt : null,
  }
}

/** Review events in submission order (oldest first), like the PR timeline. */
export async function getPullRequestReviews({
  number,
  repo,
  token,
}: {
  number: number
  repo: GitHubRepo
  token?: string
}): Promise<PullRequestReviewSummary[]> {
  const result = await githubFetch<GitHubReviewResponse[]>(
    `${githubRepoApiUrl(repo)}/pulls/${number}/reviews?per_page=100`,
    token
  )
  if (!result.ok || !Array.isArray(result.data)) return []

  const reviews: PullRequestReviewSummary[] = []
  for (const item of result.data) {
    const review = normalizeReview(item)
    if (review) reviews.push(review)
  }
  return reviews.sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0))
}

function normalizeComment(
  data: GitHubCommentResponse,
  kind: "comment" | "review-comment"
): PullRequestTimelineItem | null {
  const id =
    typeof data.id === "number" || typeof data.id === "string"
      ? String(data.id)
      : undefined
  const body = typeof data.body === "string" ? data.body.trim() : ""
  if (!id || !body) return null

  const createdAtRaw = optionalString(data.created_at)
  const createdAt = createdAtRaw ? Date.parse(createdAtRaw) : NaN

  return {
    authorAvatarUrl: optionalString(data.user?.avatar_url),
    authorLogin: optionalString(data.user?.login),
    body,
    htmlUrl: optionalString(data.html_url),
    id: `${kind}:${id}`,
    kind,
    path: kind === "review-comment" ? optionalString(data.path) : undefined,
    timestamp: Number.isFinite(createdAt) ? createdAt : null,
  }
}

async function listComments(
  url: string,
  token: string | undefined,
  kind: "comment" | "review-comment"
): Promise<PullRequestTimelineItem[]> {
  const result = await githubFetch<GitHubCommentResponse[]>(url, token)
  if (!result.ok || !Array.isArray(result.data)) return []

  const items: PullRequestTimelineItem[] = []
  for (const entry of result.data) {
    const item = normalizeComment(entry, kind)
    if (item) items.push(item)
  }
  return items
}

/**
 * The pull request conversation, oldest first: top-of-thread comments, review
 * verdicts, and line-anchored review comments. Reviews that only exist as
 * containers for line comments (no verdict, no body) are dropped.
 */
export async function getPullRequestConversation({
  number,
  repo,
  token,
}: {
  number: number
  repo: GitHubRepo
  token?: string
}): Promise<PullRequestTimelineItem[]> {
  const base = githubRepoApiUrl(repo)
  const [comments, reviewComments, reviews] = await Promise.all([
    listComments(
      `${base}/issues/${number}/comments?per_page=100`,
      token,
      "comment"
    ),
    listComments(
      `${base}/pulls/${number}/comments?per_page=100`,
      token,
      "review-comment"
    ),
    getPullRequestReviews({ number, repo, token }),
  ])

  const items: PullRequestTimelineItem[] = [...comments, ...reviewComments]
  for (const review of reviews) {
    const isVerdict =
      review.state === "approved" || review.state === "changes_requested"
    if (!isVerdict && !review.body) continue
    items.push({
      authorAvatarUrl: review.authorAvatarUrl,
      authorLogin: review.authorLogin,
      body: review.body,
      htmlUrl: review.htmlUrl,
      id: `review:${review.id}`,
      kind: "review",
      reviewState: review.state,
      timestamp: review.submittedAt,
    })
  }

  return items.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
}

type GitHubPrCommitResponse = {
  author?: { avatar_url?: unknown; login?: unknown } | null
  commit?: {
    author?: { date?: unknown; name?: unknown } | null
    message?: unknown
  } | null
  html_url?: unknown
  sha?: unknown
}

type GitHubCommitDetailResponse = {
  files?: unknown[]
  stats?: { additions?: unknown; deletions?: unknown }
}

/** Per-commit diff stats require one extra request each; cap the enrichment. */
const COMMIT_STATS_LIMIT = 30

function normalizePrCommit(
  data: GitHubPrCommitResponse
): PullRequestCommit | null {
  const sha = optionalString(data.sha)
  if (!sha) return null

  const message = optionalString(data.commit?.message) ?? ""
  const dateRaw = optionalString(data.commit?.author?.date)
  const date = dateRaw ? Date.parse(dateRaw) : NaN

  return {
    additions: 0,
    authorAvatarUrl: optionalString(data.author?.avatar_url),
    authorLogin: optionalString(data.author?.login),
    authorName: optionalString(data.commit?.author?.name) ?? null,
    deletions: 0,
    filesChanged: 0,
    htmlUrl: optionalString(data.html_url),
    sha,
    shortSha: sha.slice(0, 7),
    subject: message.split("\n")[0] ?? "",
    timestamp: Number.isFinite(date) ? date : null,
  }
}

/**
 * The pull request's commits (newest first), enriched with per-commit diff
 * stats for the most recent `COMMIT_STATS_LIMIT` entries.
 */
export async function getPullRequestCommits({
  number,
  repo,
  token,
}: {
  number: number
  repo: GitHubRepo
  token?: string
}): Promise<PullRequestCommit[]> {
  const base = githubRepoApiUrl(repo)
  const result = await githubFetch<GitHubPrCommitResponse[]>(
    `${base}/pulls/${number}/commits?per_page=100`,
    token
  )
  if (!result.ok || !Array.isArray(result.data)) return []

  const commits: PullRequestCommit[] = []
  for (const item of result.data) {
    const commit = normalizePrCommit(item)
    if (commit) commits.push(commit)
  }
  commits.reverse()

  await Promise.all(
    commits.slice(0, COMMIT_STATS_LIMIT).map(async (commit) => {
      const detail = await githubFetch<GitHubCommitDetailResponse>(
        `${base}/commits/${commit.sha}`,
        token
      )
      if (!detail.ok) return
      const { files, stats } = detail.data
      commit.additions =
        typeof stats?.additions === "number" ? stats.additions : 0
      commit.deletions =
        typeof stats?.deletions === "number" ? stats.deletions : 0
      commit.filesChanged = Array.isArray(files) ? files.length : 0
    })
  )

  return commits
}

export async function getAllowedMergeMethods({
  repo,
  token,
}: {
  repo: GitHubRepo
  token?: string
}): Promise<MergeMethod[]> {
  const result = await githubFetch<GitHubRepositoryMergeSettingsResponse>(
    githubRepoApiUrl(repo),
    token
  )
  if (!result.ok) return ["squash", "merge", "rebase"]

  const methods: MergeMethod[] = []
  if (result.data.allow_squash_merge !== false) methods.push("squash")
  if (result.data.allow_merge_commit !== false) methods.push("merge")
  if (result.data.allow_rebase_merge !== false) methods.push("rebase")
  return methods.length > 0 ? methods : ["squash"]
}

function pullRequestCompareUrl({
  base,
  body,
  head,
  repo,
  title,
}: {
  base: string
  body?: string
  head: string
  repo: GitHubRepo
  title?: string
}) {
  const url = new URL(
    `https://github.com/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(
      base
    )}...${encodeURIComponent(head)}`
  )
  url.searchParams.set("expand", "1")
  if (title) url.searchParams.set("title", title)
  if (body) url.searchParams.set("body", body)
  return url.toString()
}

function isPermissionError(status: number, message: string) {
  if (status === 403 || status === 404) return true
  return (
    status === 422 &&
    /not accessible|not authorized|permission|forbidden/i.test(message)
  )
}

export async function createPullRequest({
  base,
  body,
  draft,
  head,
  repo,
  title,
  token,
}: {
  base: string
  body?: string
  draft?: boolean
  head: string
  repo: GitHubRepo
  title: string
  token?: string
}): Promise<CreatePullRequestResult> {
  const result = await githubFetch<GitHubPullResponse>(
    `${githubRepoApiUrl(repo)}/pulls`,
    token,
    {
      body: JSON.stringify({
        base,
        body: body || undefined,
        draft: draft || undefined,
        head,
        title,
      }),
      method: "POST",
    }
  )

  if (result.ok) {
    const summary = normalizePullRequest(result.data)
    if (summary) return { kind: "created", pr: summary }
  }

  if (!result.ok && !isPermissionError(result.status, result.message)) {
    throw new Error(result.message)
  }

  return {
    compareUrl: pullRequestCompareUrl({ base, body, head, repo, title }),
    kind: "manual",
  }
}

export async function mergePullRequest({
  method,
  number,
  repo,
  token,
}: {
  method: MergeMethod
  number: number
  repo: GitHubRepo
  token?: string
}): Promise<{ merged: boolean; message: string }> {
  const result = await githubFetch<{ merged?: unknown; message?: unknown }>(
    `${githubRepoApiUrl(repo)}/pulls/${number}/merge`,
    token,
    {
      body: JSON.stringify({ merge_method: method }),
      method: "PUT",
    }
  )

  if (!result.ok) throw new Error(result.message)

  return { merged: result.data.merged === true, message: result.message }
}

export type ReactionContent =
  | "+1"
  | "-1"
  | "confused"
  | "eyes"
  | "heart"
  | "hooray"
  | "laugh"
  | "rocket"

/** Reacts on the PR conversation (pull requests are issues to the reactions
 * API). Reacting twice with the same content is a no-op on GitHub's side. */
export async function addPullRequestReaction({
  content,
  number,
  repo,
  token,
}: {
  content: ReactionContent
  number: number
  repo: GitHubRepo
  token?: string
}): Promise<boolean> {
  const result = await githubFetch<unknown>(
    `${githubRepoApiUrl(repo)}/issues/${number}/reactions`,
    token,
    {
      body: JSON.stringify({ content }),
      method: "POST",
    }
  )
  return result.ok
}

export async function addIssueCommentReaction({
  commentId,
  content,
  repo,
  token,
}: {
  commentId: string
  content: ReactionContent
  repo: GitHubRepo
  token?: string
}): Promise<boolean> {
  const result = await githubFetch<unknown>(
    `${githubRepoApiUrl(repo)}/issues/comments/${commentId}/reactions`,
    token,
    {
      body: JSON.stringify({ content }),
      method: "POST",
    }
  )
  return result.ok
}

// Submits a formal pull request review (a COMMENT verdict) so the author
// shows up in the PR's Reviewers list, instead of a plain issue comment that
// only lands in the conversation thread.
export async function createPullRequestReview({
  body,
  number,
  repo,
  token,
}: {
  body: string
  number: number
  repo: GitHubRepo
  token?: string
}): Promise<{ htmlUrl?: string }> {
  const result = await githubFetch<{ html_url?: unknown }>(
    `${githubRepoApiUrl(repo)}/pulls/${number}/reviews`,
    token,
    {
      body: JSON.stringify({ body, event: "COMMENT" }),
      method: "POST",
    }
  )

  if (!result.ok) throw new GitHubApiError(result.message, result.status)

  return { htmlUrl: optionalString(result.data.html_url) }
}

/** Marks the pull request as awaiting review from the given logins. GitHub
 * rejects logins without repository access and the PR author, so treat a
 * non-ok result as "the pending-reviewer badge is unavailable" (log the
 * message as the breadcrumb), not as a failure of the review itself. */
export async function requestPullRequestReviewers({
  number,
  repo,
  reviewers,
  token,
}: {
  number: number
  repo: GitHubRepo
  reviewers: string[]
  token?: string
}): Promise<{ message: string; ok: boolean }> {
  const result = await githubFetch<unknown>(
    `${githubRepoApiUrl(repo)}/pulls/${number}/requested_reviewers`,
    token,
    {
      body: JSON.stringify({ reviewers }),
      method: "POST",
    }
  )
  return { message: result.message, ok: result.ok }
}

/** Withdraws a pending review request. Removing a login that is not currently
 * requested is not an error worth surfacing, so this never throws. */
export async function removePullRequestReviewers({
  number,
  repo,
  reviewers,
  token,
}: {
  number: number
  repo: GitHubRepo
  reviewers: string[]
  token?: string
}): Promise<{ message: string; ok: boolean }> {
  const result = await githubFetch<unknown>(
    `${githubRepoApiUrl(repo)}/pulls/${number}/requested_reviewers`,
    token,
    {
      body: JSON.stringify({ reviewers }),
      method: "DELETE",
    }
  )
  return { message: result.message, ok: result.ok }
}

// Pull requests are issues to the comments API, so this posts a regular
// top-of-thread PR comment (not a line-anchored review comment).
export async function createIssueComment({
  body,
  number,
  repo,
  token,
}: {
  body: string
  number: number
  repo: GitHubRepo
  token?: string
}): Promise<{ htmlUrl?: string }> {
  const result = await githubFetch<{ html_url?: unknown }>(
    `${githubRepoApiUrl(repo)}/issues/${number}/comments`,
    token,
    {
      body: JSON.stringify({ body }),
      method: "POST",
    }
  )

  if (!result.ok) throw new GitHubApiError(result.message, result.status)

  return { htmlUrl: optionalString(result.data.html_url) }
}

export async function deleteBranchRef({
  branch,
  repo,
  token,
}: {
  branch: string
  repo: GitHubRepo
  token?: string
}): Promise<boolean> {
  const result = await githubFetch<unknown>(
    `${githubRepoApiUrl(repo)}/git/refs/heads/${branch
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`,
    token,
    { method: "DELETE" }
  )
  return result.ok || result.status === 204
}
