import { githubApiHeaders, githubRepoApiUrl } from "@/lib/github-repo-api"
import type { GitHubRepo } from "@/lib/github-repo"

export type PullRequestState = "open" | "closed"

export type PullRequestSummary = {
  baseRef: string
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
  base?: { ref?: unknown } | null
  draft?: unknown
  head?: { ref?: unknown; sha?: unknown } | null
  html_url?: unknown
  mergeable?: unknown
  mergeable_state?: unknown
  merged?: unknown
  merged_at?: unknown
  number?: unknown
  state?: unknown
  title?: unknown
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

type GitHubRepositoryResponse = {
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

  return {
    baseRef,
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

export async function getAllowedMergeMethods({
  repo,
  token,
}: {
  repo: GitHubRepo
  token?: string
}): Promise<MergeMethod[]> {
  const result = await githubFetch<GitHubRepositoryResponse>(
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
