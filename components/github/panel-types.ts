import type {
  ChecksSummary,
  MergeMethod,
  PullRequestSummary,
} from "@/lib/github/pull-requests"

export type GithubPanelBusyKind =
  | "commit"
  | "commit-push"
  | "create"
  | "push"
  | null

export type GithubPrEntry = PullRequestSummary & {
  checks: ChecksSummary | null
}

export type GithubPrResponse = {
  allowedMergeMethods: MergeMethod[]
  branch: string | null
  connected: boolean
  prs: GithubPrEntry[]
}
