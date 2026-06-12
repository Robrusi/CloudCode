import { NextResponse } from "next/server"

import {
  jsonError,
  jsonStringField,
  readJsonRecordOrNull,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import {
  commitSandboxChanges,
  resolveSandboxGitContext,
  withSandboxGitHubAuth,
} from "@/lib/sandbox/git"
import { gitApiErrorResponse } from "@/lib/sandbox/git-route"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const body = await readJsonRecordOrNull(request)
  if (!body) {
    return jsonError("Invalid request body.", 400)
  }

  const sandboxId = jsonStringField(body, "sandboxId")
  const message = jsonStringField(body, "message")
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }
  if (!message) {
    return jsonError("A commit message is required.", 400)
  }

  try {
    const ctx = await resolveSandboxGitContext(sandboxId)
    const { sha } = await withSandboxGitHubAuth(ctx, (env) =>
      commitSandboxChanges(ctx.sandbox, ctx.paths, env, message)
    )
    return NextResponse.json({ sha })
  } catch (error) {
    return gitApiErrorResponse(error)
  }
}
