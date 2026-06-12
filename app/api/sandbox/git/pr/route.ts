import { NextResponse } from "next/server"

import {
  jsonBooleanField,
  jsonError,
  jsonStringField,
  readJsonRecordOrNull,
  searchStringParam,
} from "@/lib/http/api-route"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github/auth"
import {
  createPullRequest,
  findPullRequestsForBranch,
  getAllowedMergeMethods,
  getCommitChecks,
  getPullRequest,
} from "@/lib/github/pull-requests"
import { fetchGitHubRepoMetadata } from "@/lib/github/repo-api"
import { requireSameOrigin } from "@/lib/http/request-security"
import {
  getCurrentSandboxBranch,
  resolveSandboxGitContext,
} from "@/lib/sandbox/git"
import { gitApiErrorResponse } from "@/lib/sandbox/git-route"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const sandboxId = searchStringParam(request, "sandboxId")
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
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

  const body = await readJsonRecordOrNull(request)
  if (!body) {
    return jsonError("Invalid request body.", 400)
  }

  const sandboxId = jsonStringField(body, "sandboxId")
  const title = jsonStringField(body, "title")
  const base = jsonStringField(body, "base") ?? ""
  const prBody = typeof body.body === "string" ? body.body : ""
  const draft = jsonBooleanField(body, "draft") === true

  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }
  if (!title) {
    return jsonError("A pull request title is required.", 400)
  }

  try {
    const ctx = await resolveSandboxGitContext(sandboxId)
    if (!ctx.repo) {
      return jsonError("This sandbox is not a GitHub repository.", 400)
    }

    const credential = await maybeGetCurrentGitHubRepoCredential(ctx.repoUrl)
    const branch = await getCurrentSandboxBranch(ctx.sandbox, ctx.paths)
    if (!branch) {
      return jsonError("Cannot open a pull request from a detached HEAD.", 400)
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
      return jsonError(
        "Unable to determine a base branch for the pull request.",
        400
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
