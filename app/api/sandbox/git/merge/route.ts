import { NextResponse } from "next/server"

import {
  jsonBooleanField,
  jsonError,
  jsonNumberField,
  jsonStringField,
  readJsonRecordOrNull,
} from "@/lib/http/api-route"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github/auth"
import {
  deleteBranchRef,
  getPullRequest,
  mergePullRequest,
  type MergeMethod,
} from "@/lib/github/pull-requests"
import { requireSameOrigin } from "@/lib/http/request-security"
import { resolveSandboxGitContext } from "@/lib/sandbox/git"
import { gitApiErrorResponse } from "@/lib/sandbox/git-route"

export const runtime = "nodejs"

const MERGE_METHODS = new Set<MergeMethod>(["merge", "rebase", "squash"])

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const body = await readJsonRecordOrNull(request)
  if (!body) {
    return jsonError("Invalid request body.", 400)
  }

  const sandboxId = jsonStringField(body, "sandboxId")
  const number = jsonNumberField(body, "number") ?? NaN
  const rawMethod = jsonStringField(body, "method")
  const method: MergeMethod = MERGE_METHODS.has(rawMethod as MergeMethod)
    ? (rawMethod as MergeMethod)
    : "squash"
  const deleteBranch = jsonBooleanField(body, "deleteBranch") === true

  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }
  if (!Number.isInteger(number)) {
    return jsonError("A pull request number is required.", 400)
  }

  try {
    const ctx = await resolveSandboxGitContext(sandboxId)
    if (!ctx.repo) {
      return jsonError("This sandbox is not a GitHub repository.", 400)
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
