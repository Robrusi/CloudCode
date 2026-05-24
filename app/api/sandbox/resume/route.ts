import { NextResponse } from "next/server"

import { resumeDaytonaSandbox } from "@/lib/daytona-sandbox"
import { requireSameOrigin } from "@/lib/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox-authorization"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  let sandboxId: string | undefined

  try {
    const body = (await request.json()) as { sandboxId?: unknown }
    if (typeof body.sandboxId === "string") sandboxId = body.sandboxId
  } catch {
    // ignore malformed bodies; validation below returns a clean error
  }

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    return NextResponse.json(await resumeDaytonaSandbox(sandboxId))
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to resume sandbox.",
      },
      { status: 500 }
    )
  }
}
