import { NextResponse } from "next/server"

import { deleteDaytonaSandboxQuietly } from "@/lib/daytona-sandbox"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: Request) {
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

  await deleteDaytonaSandboxQuietly(sandboxId)

  return NextResponse.json({
    deleted: true,
    sandboxId,
  })
}
