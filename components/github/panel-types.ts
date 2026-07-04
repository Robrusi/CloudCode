import type {
  ChecksSummary,
  MergeMethod,
  PullRequestReviewSummary,
  PullRequestSummary,
} from "@/lib/github/pull-requests"

/**
 * Common shape of a commit row in the panel: both sandbox git-log commits and
 * GitHub pull request commits satisfy it structurally.
 */
export type PanelCommit = {
  additions: number
  authorAvatarUrl?: string
  authorName: string | null
  deletions: number
  filesChanged: number
  sha: string
  shortSha: string
  subject: string
  timestamp: number | null
}

export type GithubPanelBusyKind =
  | "commit"
  | "commit-push"
  | "create"
  | "merge"
  | "push"
  | null

export type GithubPanelTab = "changes" | "commits" | "checks" | "review"

export type GithubPrEntry = PullRequestSummary & {
  checks: ChecksSummary | null
  reviews: PullRequestReviewSummary[] | null
}

export type GithubPrResponse = {
  allowedMergeMethods: MergeMethod[]
  branch: string | null
  connected: boolean
  detailsReady: boolean
  prs: GithubPrEntry[]
}
