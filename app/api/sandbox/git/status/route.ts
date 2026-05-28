import { NextResponse } from "next/server"

import {
  readSandboxGitStatus,
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
    const status = await readSandboxGitStatus(ctx.sandbox, ctx.paths)
    return NextResponse.json(status)
  } catch (error) {
    return gitApiErrorResponse(error)
  }
}
