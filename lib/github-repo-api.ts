import { parseGitHubRepoUrl, type GitHubRepo } from "@/lib/github-repo"

type GitHubRepositoryResponse = {
  default_branch?: unknown
  private?: unknown
}

export type GitHubRepoMetadata = {
  defaultBranch?: string
  private: boolean
}

export type GitHubRepoMetadataResult =
  | {
      metadata: GitHubRepoMetadata
      ok: true
    }
  | {
      ok: false
      rateLimited: boolean
      status: number
    }

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function githubApiHeaders(token?: string) {
  return {
    accept: "application/vnd.github+json",
    ...(token?.trim() ? { authorization: `Bearer ${token.trim()}` } : {}),
    "x-github-api-version": "2022-11-28",
  }
}

export function githubRepoApiUrl(repo: GitHubRepo) {
  return `https://api.github.com/repos/${encodeURIComponent(
    repo.owner
  )}/${encodeURIComponent(repo.repo)}`
}

export async function fetchGitHubRepoMetadata(
  repo: GitHubRepo,
  token?: string
): Promise<GitHubRepoMetadataResult> {
  const response = await fetch(githubRepoApiUrl(repo), {
    cache: "no-store",
    headers: githubApiHeaders(token),
  })

  if (!response.ok) {
    return {
      ok: false,
      rateLimited: response.headers.get("x-ratelimit-remaining") === "0",
      status: response.status,
    }
  }

  const data = (await response.json()) as GitHubRepositoryResponse
  return {
    metadata: {
      defaultBranch: optionalString(data.default_branch),
      private: data.private === true,
    },
    ok: true,
  }
}

export async function canClonePublicGitHubRepo(repoUrl: string) {
  const repo = parseGitHubRepoUrl(repoUrl)
  if (!repo) return false

  try {
    const result = await fetchGitHubRepoMetadata(repo)
    return result.ok && !result.metadata.private
  } catch {
    return false
  }
}
