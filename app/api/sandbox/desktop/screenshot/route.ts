import { NextResponse } from "next/server"

import { takeDaytonaDesktopScreenshot } from "@/lib/daytona-desktop"
import { requireSameOrigin } from "@/lib/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox-authorization"

export const runtime = "nodejs"
export const maxDuration = 300

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")

  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    const screenshot = await takeDaytonaDesktopScreenshot(sandboxId)
    const base64 = screenshot.screenshot?.replace(
      /^data:image\/[a-z0-9.+-]+;base64,/i,
      ""
    )

    if (!base64) {
      return jsonError("No screenshot returned by Daytona.", 502)
    }

    const bytes = Buffer.from(base64, "base64")
    return new Response(bytes, {
      headers: {
        "cache-control": "no-store",
        "content-length": String(bytes.byteLength),
        "content-type": "image/png",
      },
    })
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Failed to capture Daytona desktop screenshot.",
      500
    )
  }
}
