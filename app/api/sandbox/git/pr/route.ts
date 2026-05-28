import { NextResponse } from "next/server"

import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github-auth"
import {
  createPullRequest,
  findPullRequestsForBranch,
  getAllowedMergeMethods,
  getCommitChecks,
  getPullRequest,
} from "@/lib/github-pull-requests"
import { fetchGitHubRepoMetadata } from "@/lib/github-repo-api"
import { requireSameOrigin } from "@/lib/request-security"
import {
  getCurrentSandboxBranch,
  resolveSandboxGitContext,
} from "@/lib/sandbox-git"
import { gitApiErrorResponse } from "@/lib/sandbox-git-route"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const sandboxId = new URL(request.url).searchParams.get("sandboxId")
  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    const ctx = await resolveSandboxGitContext(sandboxId)
    const credential = await maybeGetCurrentGitHubRepoCredential(ctx.repoUrl)
    const token = credential?.token
    const branch = await getCurrentSandboxBranch(ctx.sandbox, ctx.paths)

    if (!ctx.repo || !branch) {
      return NextResponse.json({
        allowedMergeMethods: [],
        branch,
        connected: Boolean(credential),
        prs: [],
      })
    }

    const repo = ctx.repo
    const summaries = await findPullRequestsForBranch({ branch, repo, token })

    // Only open PRs need merge readiness (`mergeable`, which the list endpoint
    // omits) and CI checks; closed/merged ones are display-only.
    const prs = await Promise.all(
      summaries.map(async (summary) => {
        if (summary.state !== "open" || summary.merged) {
          return { ...summary, checks: null }
        }
        const [full, checks] = await Promise.all([
          getPullRequest({ number: summary.number, repo, token }),
          getCommitChecks({ ref: summary.headSha, repo, token }),
        ])
        return { ...(full ?? summary), checks }
      })
    )

    const hasOpen = prs.some((pr) => pr.state === "open" && !pr.merged)
    const allowedMergeMethods = hasOpen
      ? await getAllowedMergeMethods({ repo, token })
      : []

    return NextResponse.json({
      allowedMergeMethods,
      branch,
      connected: Boolean(credential),
      prs,
    })
  } catch (error) {
    return gitApiErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  let body: {
    base?: unknown
    body?: unknown
    draft?: unknown
    sandboxId?: unknown
    title?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    )
  }

  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : ""
  const title = typeof body.title === "string" ? body.title.trim() : ""
  const base = typeof body.base === "string" ? body.base.trim() : ""
  const prBody = typeof body.body === "string" ? body.body : ""
  const draft = body.draft === true

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }
  if (!title) {
    return NextResponse.json(
      { error: "A pull request title is required." },
      { status: 400 }
    )
  }

  try {
    const ctx = await resolveSandboxGitContext(sandboxId)
    if (!ctx.repo) {
      return NextResponse.json(
        { error: "This sandbox is not a GitHub repository." },
        { status: 400 }
      )
    }

    const credential = await maybeGetCurrentGitHubRepoCredential(ctx.repoUrl)
    const branch = await getCurrentSandboxBranch(ctx.sandbox, ctx.paths)
    if (!branch) {
      return NextResponse.json(
        { error: "Cannot open a pull request from a detached HEAD." },
        { status: 400 }
      )
    }

    let baseBranch = base
    if (!baseBranch) {
      const metadata = await fetchGitHubRepoMetadata(
        ctx.repo,
        credential?.token
      )
      baseBranch = (metadata.ok && metadata.metadata.defaultBranch) || ""
    }
    if (!baseBranch) {
      return NextResponse.json(
        { error: "Unable to determine a base branch for the pull request." },
        { status: 400 }
      )
    }

    const result = await createPullRequest({
      base: baseBranch,
      body: prBody,
      draft,
      head: branch,
      repo: ctx.repo,
      title,
      token: credential?.token,
    })

    return NextResponse.json(result)
  } catch (error) {
    return gitApiErrorResponse(error)
  }
}
