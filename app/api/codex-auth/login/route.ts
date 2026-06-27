import { NextRequest, NextResponse } from "next/server"

import { getConvexAuthToken } from "@/lib/codex/auth"
import {
  CODEX_DEVICE_AUTH_COOKIE,
  CODEX_DEVICE_AUTH_COOKIE_PATH,
  codexAuthWindowHtml,
  createCodexDeviceLoginSession,
  createCodexOAuthLoginUrl,
  encodeCodexDeviceLoginSession,
} from "@/lib/codex/oauth"

export const runtime = "nodejs"

function html(message: string, targetOrigin: string) {
  return new NextResponse(
    codexAuthWindowHtml({
      error: message,
      message,
      status: "error",
      targetOrigin,
      title: "ChatGPT sign-in could not start",
    }),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      status: 400,
    }
  )
}

function loopbackHost(hostname: string) {
  const normalized = hostname.toLowerCase()

  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  )
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)

  try {
    const convexToken = await getConvexAuthToken()

    if (loopbackHost(url.hostname)) {
      const loginUrl = await createCodexOAuthLoginUrl({
        appOrigin: url.origin,
        convexToken,
      })

      return NextResponse.redirect(loginUrl)
    }

    const session = await createCodexDeviceLoginSession()
    const response = NextResponse.redirect(
      new URL("/api/codex-auth/device", url.origin)
    )

    response.cookies.set(
      CODEX_DEVICE_AUTH_COOKIE,
      encodeCodexDeviceLoginSession(session),
      {
        httpOnly: true,
        maxAge: Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000)),
        path: CODEX_DEVICE_AUTH_COOKIE_PATH,
        sameSite: "lax",
        secure: url.protocol === "https:",
      }
    )

    return response
  } catch (error) {
    return html(
      error instanceof Error
        ? error.message
        : "Unable to start ChatGPT sign-in.",
      url.origin
    )
  }
}
