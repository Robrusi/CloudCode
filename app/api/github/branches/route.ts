import { NextResponse } from "next/server"

import { jsonError, searchStringParam } from "@/lib/http/api-route"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github/auth"
import { parseGitHubRepoUrl } from "@/lib/github/repo"
import {
  fetchGitHubRepoMetadata,
  githubApiHeaders,
} from "@/lib/github/repo-api"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const repoUrl = searchStringParam(request, "repoUrl")

  if (!repoUrl) {
    return jsonError("repoUrl required", 400)
  }

  const parsed = parseGitHubRepoUrl(repoUrl)
  if (!parsed) {
    return jsonError("Unsupported GitHub URL.", 400)
  }

  try {
    const credential = await maybeGetCurrentGitHubRepoCredential(repoUrl)
    const repoMetadata = await fetchGitHubRepoMetadata(
      parsed,
      credential?.token
    )
    if (!repoMetadata.ok) {
      if (repoMetadata.status === 404) {
        return jsonError("Repository not found.", 404)
      }
      if (repoMetadata.status === 401 || repoMetadata.status === 403) {
        return jsonError(
          repoMetadata.rateLimited
            ? "GitHub rate limit hit. Connect GitHub or try again later."
            : "GitHub denied access. Reconnect GitHub with repo access.",
          repoMetadata.status
        )
      }

      return jsonError(
        `GitHub API error: ${repoMetadata.status}`,
        repoMetadata.status
      )
    }

    if (repoMetadata.metadata.private && !credential?.token) {
      return jsonError(
        "Install the GitHub App on this repository and authorize your GitHub user.",
        401
      )
    }

    const headers = githubApiHeaders(credential?.token)

    const branches: string[] = []
    const defaultBranch = repoMetadata.metadata.defaultBranch
    const branchPageUrl = (page: number) =>
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/branches?per_page=100&page=${page}`

    async function readBranchPage(page: number) {
      const response = await fetch(branchPageUrl(page), {
        headers,
        cache: "no-store",
      })
      if (!response.ok) {
        if (response.status === 409) return []

        const remaining = response.headers.get("x-ratelimit-remaining")
        const isRateLimited =
          (response.status === 403 || response.status === 429) &&
          remaining === "0"
        throw new Response(
          JSON.stringify({
            error: isRateLimited
              ? "GitHub rate limit hit. Connect GitHub or try again later."
              : `GitHub API error: ${response.status}`,
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: response.status,
          }
        )
      }

      const items = (await response.json()) as Array<{ name: string }>
      return Array.isArray(items) ? items : []
    }

    function collectBranchNames(items: Array<{ name: string }>) {
      for (const item of items) {
        if (typeof item.name === "string") branches.push(item.name)
      }
    }

    const firstPage = await readBranchPage(1)
    collectBranchNames(firstPage)
    if (firstPage.length === 0) {
      return NextResponse.json({ branches, defaultBranch })
    }
    if (firstPage.length < 100) {
      return NextResponse.json({ branches, defaultBranch })
    }

    for (let page = 2; page <= 5; page += 1) {
      const items = await readBranchPage(page)
      collectBranchNames(items)
      if (items.length < 100) break
    }

    return NextResponse.json({ branches, defaultBranch })
  } catch (error) {
    if (error instanceof Response) {
      const body = (await error.json().catch(() => null)) as {
        error?: unknown
      } | null
      return jsonError(
        typeof body?.error === "string"
          ? body.error
          : "Failed to fetch branches.",
        error.status
      )
    }
    return jsonError(
      error instanceof Error ? error.message : "Failed to fetch branches.",
      500
    )
  }
}
