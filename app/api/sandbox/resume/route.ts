import { NextResponse } from "next/server"

import { resumeDaytonaSandbox } from "@/lib/daytona-sandbox"

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

  try {
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
