import { NextResponse } from "next/server"

import { getConvexAuthToken } from "@/lib/codex/auth"
import {
  CODEX_OAUTH_STATE_COOKIE,
  CODEX_OAUTH_STATE_COOKIE_MAX_AGE,
  CODEX_OAUTH_STATE_COOKIE_PATH,
  createCodexLoginRequest,
} from "@/lib/codex/oauth"
import { escapeHtml } from "@/lib/shared/html-escape"

export const runtime = "nodejs"

function html(message: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Cloudcode Auth</title><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><h1 style="font-size:1.25rem">ChatGPT sign-in could not start</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to Cloudcode</a></p></body>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      status: 400,
    }
  )
}

function returnUrlForRequest(url: URL) {
  const next = url.searchParams.get("next")

  return new URL(
    next === "chat" ? "/" : "/?view=settings",
    url.origin
  ).toString()
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    await getConvexAuthToken()
    const addAccount =
      url.searchParams.get("add") === "1" ||
      url.searchParams.get("mode") === "add"
    const profile = url.searchParams.get("profile") ?? undefined
    const { cookieValue, loginUrl } = createCodexLoginRequest({
      appOrigin: url.origin,
      forceLogin: addAccount,
      profile,
      returnUrl: returnUrlForRequest(url),
      useAccountProfile: addAccount && !profile,
    })
    const response = NextResponse.redirect(loginUrl)
    response.cookies.set(CODEX_OAUTH_STATE_COOKIE, cookieValue, {
      httpOnly: true,
      maxAge: CODEX_OAUTH_STATE_COOKIE_MAX_AGE,
      path: CODEX_OAUTH_STATE_COOKIE_PATH,
      sameSite: "lax",
      secure: url.protocol === "https:",
    })

    return response
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start ChatGPT sign-in."

    return html(message)
  }
}
