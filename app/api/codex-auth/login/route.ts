import { NextResponse } from "next/server"

import { createCodexLoginUrl } from "@/lib/codex-oauth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const loginUrl = await createCodexLoginUrl({
    appOrigin: url.origin,
    profile: url.searchParams.get("profile") ?? undefined,
  })

  return NextResponse.redirect(loginUrl)
}
