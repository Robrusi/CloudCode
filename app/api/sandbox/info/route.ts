import { NextResponse } from "next/server"

import {
  getDaytonaSandbox,
  normalizeDaytonaState,
} from "@/lib/daytona-sandbox"

export const runtime = "nodejs"

function timeValue(value?: string) {
  return value ? new Date(value).getTime() : null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    const sandbox = await getDaytonaSandbox(sandboxId)
    await sandbox.refreshData().catch(() => undefined)

    return NextResponse.json({
      autoArchiveInterval: sandbox.autoArchiveInterval ?? null,
      autoDeleteInterval: sandbox.autoDeleteInterval ?? null,
      autoStopInterval: sandbox.autoStopInterval ?? null,
      createdAt: timeValue(sandbox.createdAt),
      lastActivityAt: timeValue(sandbox.lastActivityAt),
      rawState: sandbox.state,
      sandboxId: sandbox.id,
      state: normalizeDaytonaState(sandbox.state),
      updatedAt: timeValue(sandbox.updatedAt),
    })
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
