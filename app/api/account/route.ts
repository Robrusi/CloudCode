import { auth, clerkClient } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import { convexHttpClientForSession } from "@/lib/convex/http"
import { deleteDaytonaSandboxQuietly } from "@/lib/daytona/sandbox"
import { disconnectCurrentGitHubAppUser } from "@/lib/github/app"
import { jsonError } from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"

export const runtime = "nodejs"

export async function DELETE(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const session = await auth()

  if (!session.userId) {
    return jsonError("Not authenticated.", 401)
  }

  try {
    // Revoke the GitHub grant while the stored token still exists; the Convex
    // rows it cleans up are deleted again below, which is harmless.
    try {
      await disconnectCurrentGitHubAppUser()
    } catch {
      // Revocation is best-effort; account deletion must not depend on it.
    }

    const client = await convexHttpClientForSession(session)
    const { sandboxIds } = (await client.mutation(
      api.users.deleteAccount,
      {}
    )) as { sandboxIds: string[] }

    await Promise.all(
      sandboxIds.map((sandboxId) => deleteDaytonaSandboxQuietly(sandboxId))
    )

    const clerk = await clerkClient()
    await clerk.users.deleteUser(session.userId)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to delete account.",
      500
    )
  }
}
