import { NextResponse } from "next/server"

import {
  jsonError,
  jsonNumberField,
  jsonStringField,
  readJsonRecordOrNull,
  searchStringParam,
} from "@/lib/http/api-route"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github/auth"
import {
  createIssueComment,
  getPullRequestConversation,
} from "@/lib/github/pull-requests"
import { requireSameOrigin } from "@/lib/http/request-security"
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
    const items = await getPullRequestConversation({
      number,
      repo: ctx.repo,
      token,
    })
    return NextResponse.json({ items })
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
  const number = jsonNumberField(body, "number") ?? NaN
  const commentBody = jsonStringField(body, "body")?.trim()

  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }
  if (!Number.isInteger(number) || number <= 0) {
    return jsonError("A pull request number is required.", 400)
  }
  if (!commentBody) {
    return jsonError("A comment body is required.", 400)
  }

  try {
    const ctx = await resolveSandboxGitContext(sandboxId)
    if (!ctx.repo) {
      return jsonError("This sandbox is not a GitHub repository.", 400)
    }

    const token = (await maybeGetCurrentGitHubRepoCredential(ctx.repoUrl))
      ?.token
    const result = await createIssueComment({
      body: commentBody,
      number,
      repo: ctx.repo,
      token,
    })
    return NextResponse.json(result)
  } catch (error) {
    return gitApiErrorResponse(error)
  }
}
