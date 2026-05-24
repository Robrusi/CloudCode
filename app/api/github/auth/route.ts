import { NextResponse } from "next/server"

import { getCurrentGitHubAuthStatus } from "@/lib/github-auth"
import { disconnectCurrentGitHubAppUser } from "@/lib/github-app"
import { requireSameOrigin } from "@/lib/request-security"

export const runtime = "nodejs"

export async function GET() {
  try {
    return NextResponse.json(await getCurrentGitHubAuthStatus())
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to read GitHub auth status.",
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    return NextResponse.json(await disconnectCurrentGitHubAppUser())
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to remove GitHub connection.",
      },
      { status: 500 }
    )
  }
}
