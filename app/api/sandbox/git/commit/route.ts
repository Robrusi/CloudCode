import { NextResponse } from "next/server"

import { requireSameOrigin } from "@/lib/request-security"
import {
  commitSandboxChanges,
  resolveSandboxGitContext,
  withSandboxGitHubAuth,
} from "@/lib/sandbox-git"
import { gitApiErrorResponse } from "@/lib/sandbox-git-route"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  let body: { message?: unknown; sandboxId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    )
  }

  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : ""
  const message = typeof body.message === "string" ? body.message.trim() : ""
  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }
  if (!message) {
    return NextResponse.json(
      { error: "A commit message is required." },
      { status: 400 }
    )
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
