import { canonicalGitHubRepoUrl } from "@/lib/github/repo"

export type GitHubAutomationEventName =
  | "issueOpened"
  | "issueClosed"
  | "issueCommented"
  | "pullRequestOpened"
  | "pullRequestMerged"
  | "pullRequestReviewSubmitted"
  | "push"

export type GitHubAutomationEvent = {
  action: string
  actorLogin?: string
  branch?: string
  comment?: {
    body?: string
    id?: string
    url?: string
  }
  event: GitHubAutomationEventName
  issue?: {
    body?: string
    isPullRequest: boolean
    number: number
    title?: string
    url?: string
  }
  installationId: string
  pullRequest?: {
    baseBranch?: string
    body?: string
    headBranch?: string
    number: number
    title?: string
    url?: string
  }
  push?: {
    after?: string
    before?: string
    compareUrl?: string
    headCommitMessage?: string
  }
  repoFullName: string
  repoUrl: string
  review?: {
    body?: string
    state?: string
    url?: string
  }
}

type GitHubWebhookPayload = {
  action?: unknown
  comment?: {
    body?: unknown
    html_url?: unknown
    id?: unknown
    user?: { login?: unknown } | null
  } | null
  after?: unknown
  before?: unknown
  compare?: unknown
  head_commit?: { message?: unknown } | null
  issue?: {
    body?: unknown
    html_url?: unknown
    number?: unknown
    pull_request?: unknown
    title?: unknown
  } | null
  installation?: { id?: unknown } | null
  pull_request?: {
    base?: { ref?: unknown } | null
    body?: unknown
    head?: { ref?: unknown } | null
    html_url?: unknown
    merged?: unknown
    number?: unknown
    title?: unknown
  } | null
  ref?: unknown
  repository?: { full_name?: unknown } | null
  review?: {
    body?: unknown
    html_url?: unknown
    state?: unknown
    user?: { login?: unknown } | null
  } | null
  sender?: { login?: unknown } | null
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function identifier(value: unknown) {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : undefined
}

function repositoryContext(payload: GitHubWebhookPayload) {
  const repoFullName = optionalString(payload.repository?.full_name)
  const repoUrl = repoFullName ? canonicalGitHubRepoUrl(repoFullName) : null
  return repoFullName && repoUrl ? { repoFullName, repoUrl } : null
}

function issueContext(issue: GitHubWebhookPayload["issue"]) {
  const number = typeof issue?.number === "number" ? issue.number : undefined
  if (!number) return undefined
  return {
    body: optionalString(issue?.body),
    isPullRequest: Boolean(issue?.pull_request),
    number,
    title: optionalString(issue?.title),
    url: optionalString(issue?.html_url),
  }
}

function pullRequestContext(pr: GitHubWebhookPayload["pull_request"]) {
  const number = typeof pr?.number === "number" ? pr.number : undefined
  if (!number) return undefined
  return {
    baseBranch: optionalString(pr?.base?.ref),
    body: optionalString(pr?.body),
    headBranch: optionalString(pr?.head?.ref),
    number,
    title: optionalString(pr?.title),
    url: optionalString(pr?.html_url),
  }
}

/** Converts GitHub's webhook-specific actions into stable automation events.
 * Unsupported actions return null and never enter the durable worker queue. */
export function parseGitHubAutomationEvent(
  webhookEvent: string | null,
  value: unknown
): GitHubAutomationEvent | null {
  if (!value || typeof value !== "object") return null
  const payload = value as GitHubWebhookPayload
  const repository = repositoryContext(payload)
  const installationId = identifier(payload.installation?.id)
  if (!repository || !installationId) return null

  const action = optionalString(payload.action) ?? webhookEvent ?? "unknown"
  const senderLogin = optionalString(payload.sender?.login)

  if (webhookEvent === "issues") {
    if (action !== "opened" && action !== "closed") return null
    const issue = issueContext(payload.issue)
    if (!issue || issue.isPullRequest) return null
    return {
      action,
      actorLogin: senderLogin,
      event: action === "opened" ? "issueOpened" : "issueClosed",
      issue,
      installationId,
      ...repository,
    }
  }

  if (webhookEvent === "issue_comment" && action === "created") {
    const issue = issueContext(payload.issue)
    const commentId = identifier(payload.comment?.id)
    if (!issue || !commentId) return null
    return {
      action,
      actorLogin: optionalString(payload.comment?.user?.login) ?? senderLogin,
      comment: {
        body: optionalString(payload.comment?.body),
        id: commentId,
        url: optionalString(payload.comment?.html_url),
      },
      event: "issueCommented",
      issue,
      installationId,
      ...repository,
    }
  }

  if (webhookEvent === "pull_request") {
    const pullRequest = pullRequestContext(payload.pull_request)
    if (!pullRequest) return null
    if (action === "opened") {
      return {
        action,
        actorLogin: senderLogin,
        event: "pullRequestOpened",
        installationId,
        pullRequest,
        ...repository,
      }
    }
    if (action === "closed" && payload.pull_request?.merged === true) {
      return {
        action,
        actorLogin: senderLogin,
        event: "pullRequestMerged",
        installationId,
        pullRequest,
        ...repository,
      }
    }
    return null
  }

  if (webhookEvent === "pull_request_review" && action === "submitted") {
    const pullRequest = pullRequestContext(payload.pull_request)
    if (!pullRequest || !payload.review) return null
    return {
      action,
      actorLogin: optionalString(payload.review.user?.login) ?? senderLogin,
      event: "pullRequestReviewSubmitted",
      installationId,
      pullRequest,
      review: {
        body: optionalString(payload.review.body),
        state: optionalString(payload.review.state),
        url: optionalString(payload.review.html_url),
      },
      ...repository,
    }
  }

  if (webhookEvent === "push") {
    const ref = optionalString(payload.ref)
    if (!ref?.startsWith("refs/heads/")) return null
    return {
      action,
      actorLogin: senderLogin,
      branch: ref.slice("refs/heads/".length),
      event: "push",
      installationId,
      push: {
        after: optionalString(payload.after),
        before: optionalString(payload.before),
        compareUrl: optionalString(payload.compare),
        headCommitMessage: optionalString(payload.head_commit?.message),
      },
      ...repository,
    }
  }

  return null
}
