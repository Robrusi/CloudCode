import { auth, clerkClient } from "@clerk/nextjs/server"
import { ConvexHttpClient } from "convex/browser"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import { getConvexAuthTokenForSession } from "@/lib/codex-auth"
import { deleteDaytonaSandboxQuietly } from "@/lib/daytona-sandbox"
import { disconnectCurrentGitHubAppUser } from "@/lib/github-app"
import { requireSameOrigin } from "@/lib/request-security"

export const runtime = "nodejs"

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL

  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before using Convex storage.")
  }

  return url
}

export async function DELETE(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const session = await auth()

  if (!session.userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 })
  }

  try {
    // Revoke the GitHub grant while the stored token still exists; the Convex
    // rows it cleans up are deleted again below, which is harmless.
    try {
      await disconnectCurrentGitHubAppUser()
    } catch {
      // Revocation is best-effort; account deletion must not depend on it.
    }

    const client = new ConvexHttpClient(getConvexUrl())
    client.setAuth(await getConvexAuthTokenForSession(session))
    const { sandboxIds } = await client.mutation(api.users.deleteAccount, {})

    await Promise.all(
      sandboxIds.map((sandboxId) => deleteDaytonaSandboxQuietly(sandboxId))
    )

    const clerk = await clerkClient()
    await clerk.users.deleteUser(session.userId)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to delete account.",
      },
      { status: 500 }
    )
  }
}
