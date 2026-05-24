import { NextResponse } from "next/server"

import { getCodexAuthStatus, saveCodexAuthJson } from "@/lib/codex-auth"
import { requireSameOrigin } from "@/lib/request-security"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const status = await getCodexAuthStatus(
      searchParams.get("profile") ?? undefined
    )

    return NextResponse.json(status)
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to read auth status.",
      },
      { status: 400 }
    )
  }
}

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = (await request.json()) as {
      authJson?: unknown
      profile?: unknown
    }

    if (typeof body.authJson !== "string") {
      return NextResponse.json(
        { error: "authJson must be a string." },
        { status: 400 }
      )
    }

    const status = await saveCodexAuthJson(
      typeof body.profile === "string" ? body.profile : undefined,
      body.authJson
    )

    return NextResponse.json(status)
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to store auth.json.",
      },
      { status: 400 }
    )
  }
}
