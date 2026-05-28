import { NextResponse } from "next/server"

import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github-auth"
import {
  deleteBranchRef,
  getPullRequest,
  mergePullRequest,
  type MergeMethod,
} from "@/lib/github-pull-requests"
import { requireSameOrigin } from "@/lib/request-security"
import { resolveSandboxGitContext } from "@/lib/sandbox-git"
import { gitApiErrorResponse } from "@/lib/sandbox-git-route"

export const runtime = "nodejs"

const MERGE_METHODS = new Set<MergeMethod>(["merge", "rebase", "squash"])

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  let body: {
    deleteBranch?: unknown
    method?: unknown
    number?: unknown
    sandboxId?: unknown
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
  const number = typeof body.number === "number" ? body.number : NaN
  const method: MergeMethod = MERGE_METHODS.has(body.method as MergeMethod)
    ? (body.method as MergeMethod)
    : "squash"
  const deleteBranch = body.deleteBranch === true

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }
  if (!Number.isInteger(number)) {
    return NextResponse.json(
      { error: "A pull request number is required." },
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

    const token = (await maybeGetCurrentGitHubRepoCredential(ctx.repoUrl))
      ?.token
    const pr = deleteBranch
      ? await getPullRequest({ number, repo: ctx.repo, token })
      : null

    const merge = await mergePullRequest({
      method,
      number,
      repo: ctx.repo,
      token,
    })

    if (deleteBranch && merge.merged && pr) {
      await deleteBranchRef({ branch: pr.headRef, repo: ctx.repo, token })
    }

    return NextResponse.json(merge)
  } catch (error) {
    return gitApiErrorResponse(error)
  }
}
