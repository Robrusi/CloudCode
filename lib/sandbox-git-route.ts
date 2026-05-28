import { NextResponse } from "next/server"

import { NothingToCommitError } from "@/lib/sandbox-git"
import { SandboxAuthorizationError } from "@/lib/sandbox-authorization"

export function gitApiErrorResponse(error: unknown) {
  if (error instanceof SandboxAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  if (error instanceof NothingToCommitError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : "Git operation failed.",
    },
    { status: 500 }
  )
}
