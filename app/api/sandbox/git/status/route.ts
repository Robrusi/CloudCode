import { NextResponse } from "next/server"

import { jsonError, searchStringParam } from "@/lib/http/api-route"
import {
  readSandboxGitStatus,
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
    const status = await readSandboxGitStatus(ctx.sandbox, ctx.paths)
    return NextResponse.json(status)
  } catch (error) {
    return gitApiErrorResponse(error)
  }
}
