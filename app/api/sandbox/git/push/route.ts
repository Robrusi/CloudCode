import { NextResponse } from "next/server"

import { requireSameOrigin } from "@/lib/request-security"
import {
  getCurrentSandboxBranch,
  pushSandboxBranch,
  resolveSandboxGitContext,
  withSandboxGitHubAuth,
} from "@/lib/sandbox-git"
import { gitApiErrorResponse } from "@/lib/sandbox-git-route"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  let body: { sandboxId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    )
  }

  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : ""
  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
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
