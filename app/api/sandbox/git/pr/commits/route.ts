import { NextResponse } from "next/server"

import { jsonError, searchStringParam } from "@/lib/http/api-route"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github/auth"
import { getPullRequestCommits } from "@/lib/github/pull-requests"
import { resolveSandboxGitContext } from "@/lib/sandbox/git"
import { gitApiErrorResponse } from "@/lib/sandbox/git-route"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const sandboxId = searchStringParam(request, "sandboxId")
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  const number = Number.parseInt(searchStringParam(request, "number") ?? "", 10)
  if (!Number.isInteger(number) || number <= 0) {
    return jsonError("A pull request number is required.", 400)
  }

  try {
    const ctx = await resolveSandboxGitContext(sandboxId)
    if (!ctx.repo) {
      return jsonError("This sandbox is not a GitHub repository.", 400)
    }

    const token = (await maybeGetCurrentGitHubRepoCredential(ctx.repoUrl))
      ?.token
    const commits = await getPullRequestCommits({
      number,
      repo: ctx.repo,
      token,
    })
    return NextResponse.json({ commits })
  } catch (error) {
    return gitApiErrorResponse(error)
  }
}
