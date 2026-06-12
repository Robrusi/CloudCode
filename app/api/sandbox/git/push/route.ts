import { NextResponse } from "next/server"

import {
  jsonError,
  jsonStringField,
  readJsonRecordOrNull,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import {
  getCurrentSandboxBranch,
  pushSandboxBranch,
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
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    const ctx = await resolveSandboxGitContext(sandboxId)
    const branch = await withSandboxGitHubAuth(ctx, async (env) => {
      const current = await getCurrentSandboxBranch(ctx.sandbox, ctx.paths, {
        env,
      })
      if (!current) throw new Error("Cannot push from a detached HEAD.")
      await pushSandboxBranch(ctx.sandbox, ctx.paths, env, current)
      return current
    })
    return NextResponse.json({ branch, ok: true })
  } catch (error) {
    return gitApiErrorResponse(error)
  }
}
