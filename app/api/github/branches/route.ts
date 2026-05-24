import { NextResponse } from "next/server"

import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github-auth"
import { parseGitHubRepoUrl } from "@/lib/github-repo"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const repoUrl = searchParams.get("repoUrl")?.trim()

  if (!repoUrl) {
    return NextResponse.json({ error: "repoUrl required" }, { status: 400 })
  }

  const parsed = parseGitHubRepoUrl(repoUrl)
  if (!parsed) {
    return NextResponse.json(
      { error: "Unsupported GitHub URL." },
      { status: 400 }
    )
  }

  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  }
  const credential = await maybeGetCurrentGitHubRepoCredential(repoUrl)
  if (!credential?.token) {
    return NextResponse.json(
      {
        error:
          "Install the GitHub App on this repository and authorize your GitHub user.",
      },
      { status: 401 }
    )
  }
  headers.authorization = `Bearer ${credential.token}`

  const branches: string[] = []
  let defaultBranch: string | undefined

  try {
    const repoRes = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
      { headers, cache: "no-store" }
    )
    if (repoRes.ok) {
      const repoData = (await repoRes.json()) as { default_branch?: string }
      defaultBranch = repoData.default_branch
    } else if (repoRes.status === 404) {
      return NextResponse.json(
        { error: "Repository not found." },
        { status: 404 }
      )
    } else if (repoRes.status === 401 || repoRes.status === 403) {
      const remaining = repoRes.headers.get("x-ratelimit-remaining")
      const isRateLimited = remaining === "0"
      return NextResponse.json(
        {
          error: isRateLimited
            ? "GitHub rate limit hit. Connect GitHub or try again later."
            : "GitHub denied access. Reconnect GitHub with repo access.",
        },
        { status: repoRes.status }
      )
    }

    const branchResponses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        fetch(
          `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/branches?per_page=100&page=${index + 1}`,
          { headers, cache: "no-store" }
        )
      )
    )
    const failedBranchResponse = branchResponses.find((res) => !res.ok)
    if (failedBranchResponse) {
      const remaining = failedBranchResponse.headers.get(
        "x-ratelimit-remaining"
      )
      const isRateLimited =
        (failedBranchResponse.status === 403 ||
          failedBranchResponse.status === 429) &&
        remaining === "0"
      return NextResponse.json(
        {
          error: isRateLimited
            ? "GitHub rate limit hit. Connect GitHub or try again later."
            : `GitHub API error: ${failedBranchResponse.status}`,
        },
        { status: failedBranchResponse.status }
      )
    }

    const branchPages = await Promise.all(
      branchResponses.map(
        (res) => res.json() as Promise<Array<{ name: string }>>
      )
    )
    for (const items of branchPages) {
      for (const item of items) {
        if (typeof item.name === "string") branches.push(item.name)
      }
      if (items.length < 100) break
    }

    return NextResponse.json({ branches, defaultBranch })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch branches.",
      },
      { status: 500 }
    )
  }
}
