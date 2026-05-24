import { NextRequest, NextResponse } from "next/server"

import { getConvexAuthToken } from "@/lib/codex-auth"
import {
  createGitHubAppState,
  createGitHubAppUserLoginUrl,
  GITHUB_APP_USER_NEXT_COOKIE,
  GITHUB_APP_USER_STATE_COOKIE,
} from "@/lib/github-app"
import { escapeHtml } from "@/lib/html-escape"

export const runtime = "nodejs"

function html(message: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Cloudcode GitHub App</title><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><h1 style="font-size:1.25rem">GitHub authorization could not start</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to Cloudcode</a></p></body>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      status: 400,
    }
  )
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    await getConvexAuthToken()

    const nextParam = url.searchParams.get("next")
    const next =
      nextParam === "install" || nextParam === "settings" ? nextParam : ""
    const state = createGitHubAppState()
    const response = NextResponse.redirect(
      createGitHubAppUserLoginUrl({
        state,
      })
    )
    const cookieOptions = {
      httpOnly: true,
      maxAge: 15 * 60,
      path: "/api/github/app",
      sameSite: "lax" as const,
      secure: url.protocol === "https:",
    }
    response.cookies.set(GITHUB_APP_USER_STATE_COOKIE, state, cookieOptions)
    if (next) {
      response.cookies.set(GITHUB_APP_USER_NEXT_COOKIE, next, cookieOptions)
    } else {
      response.cookies.set(GITHUB_APP_USER_NEXT_COOKIE, "", {
        maxAge: 0,
        path: "/api/github/app",
      })
    }

    return response
  } catch (error) {
    return html(
      error instanceof Error
        ? error.message
        : "Unable to start GitHub authorization."
    )
  }
}
