import { NextResponse } from "next/server"

import { readDaytonaSandboxInfo } from "@/lib/daytona-sandbox"
import { requireCurrentUserSandbox } from "@/lib/sandbox-authorization"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    return NextResponse.json(await readDaytonaSandboxInfo(sandboxId))
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Sandbox not found",
        notFound: true,
      },
      { status: 404 }
    )
  }
}
