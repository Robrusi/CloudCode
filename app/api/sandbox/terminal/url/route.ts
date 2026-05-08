import { NextResponse } from "next/server"

import { getDaytonaTerminalUrl } from "@/lib/daytona-sandbox"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    return NextResponse.json({
      url: await getDaytonaTerminalUrl(sandboxId),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to open Daytona terminal",
      },
      { status: 500 }
    )
  }
}
