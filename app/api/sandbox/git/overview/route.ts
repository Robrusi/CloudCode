import { NextResponse } from "next/server"

import { jsonError, searchStringParam } from "@/lib/http/api-route"
import {
  readSandboxGitOverview,
  resolveSandboxGitContext,
} from "@/lib/sandbox/git"
import { gitApiErrorResponse } from "@/lib/sandbox/git-route"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const sandboxId = searchStringParam(request, "sandboxId")
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  const baseBranch = searchStringParam(request, "base") ?? undefined
  const includeDetails = searchStringParam(request, "details") === "1"

  try {
    const ctx = await resolveSandboxGitContext(sandboxId)
    const overview = await readSandboxGitOverview(ctx.sandbox, ctx.paths, {
      baseBranch,
      includeDetails,
    })
    return NextResponse.json(overview)
  } catch (error) {
    return gitApiErrorResponse(error)
  }
}
