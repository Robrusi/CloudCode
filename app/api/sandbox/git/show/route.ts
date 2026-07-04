import { NextResponse } from "next/server"

import { jsonError, searchStringParam } from "@/lib/http/api-route"
import {
  readSandboxCommitDiff,
  resolveSandboxGitContext,
} from "@/lib/sandbox/git"
import { gitApiErrorResponse } from "@/lib/sandbox/git-route"

export const runtime = "nodejs"

const SHA_PATTERN = /^[0-9a-f]{7,64}$/i

export async function GET(request: Request) {
  const sandboxId = searchStringParam(request, "sandboxId")
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  const sha = searchStringParam(request, "sha")
  if (!sha || !SHA_PATTERN.test(sha)) {
    return jsonError("A commit SHA is required.", 400)
  }

  try {
    const ctx = await resolveSandboxGitContext(sandboxId)
    const diff = await readSandboxCommitDiff(ctx.sandbox, ctx.paths, sha)
    return NextResponse.json(diff)
  } catch (error) {
    return gitApiErrorResponse(error)
  }
}
