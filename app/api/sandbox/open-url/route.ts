import { NextResponse } from "next/server"

import { getSandboxPreviewProxyUrl } from "@/lib/sandbox-preview-proxy"

export const runtime = "nodejs"

export async function POST(request: Request) {
  let body: { sandboxId?: unknown; url?: unknown }

  try {
    body = (await request.json()) as {
      sandboxId?: unknown
      url?: unknown
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const sandboxId =
    typeof body.sandboxId === "string" ? body.sandboxId.trim() : ""
  const url = typeof body.url === "string" ? body.url.trim() : ""

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 })
  }

  try {
    const forwardedHost = request.headers.get("x-forwarded-host")?.trim()
    return NextResponse.json({
      url: await getSandboxPreviewProxyUrl({
        requestHost: forwardedHost || request.headers.get("host"),
        sandboxId,
        targetUrl: url,
      }),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to open sandbox URL."
    const isInputError =
      error instanceof Error && error.name === "SandboxPreviewTargetError"

    return NextResponse.json(
      {
        error: message,
      },
      { status: isInputError ? 400 : 500 }
    )
  }
}
