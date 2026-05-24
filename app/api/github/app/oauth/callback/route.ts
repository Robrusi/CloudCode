import { NextRequest, NextResponse } from "next/server"

import {
  completeGitHubAppUserAuthorization,
  GITHUB_APP_STATE_COOKIE,
  GITHUB_APP_USER_NEXT_COOKIE,
  GITHUB_APP_USER_STATE_COOKIE,
  saveGitHubAppInstallation,
  syncCurrentGitHubAppUserInstallations,
  verifyGitHubAppInstallation,
} from "@/lib/github-app"
import { escapeHtml } from "@/lib/html-escape"

export const runtime = "nodejs"

function html(message: string, status = 400) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Cloudcode GitHub App</title><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><h1 style="font-size:1.25rem">GitHub authorization failed</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to Cloudcode</a></p></body>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      status,
    }
  )
}

function clearUserAuthCookies(response: NextResponse) {
  for (const name of [
    GITHUB_APP_STATE_COOKIE,
    GITHUB_APP_USER_NEXT_COOKIE,
    GITHUB_APP_USER_STATE_COOKIE,
  ]) {
    response.cookies.set(name, "", {
      maxAge: 0,
      path: "/api/github/app",
    })
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const installationId = url.searchParams.get("installation_id")
  const returnedState = url.searchParams.get("state")
  const expectedState = request.cookies.get(GITHUB_APP_USER_STATE_COOKIE)?.value
  const next = request.cookies.get(GITHUB_APP_USER_NEXT_COOKIE)?.value

  if (!code) {
    const response = html("Missing GitHub authorization code or state.")
    clearUserAuthCookies(response)
    return response
  }

  const stateMatches =
    returnedState && expectedState && returnedState === expectedState
  if (!stateMatches) {
    const response = html("GitHub authorization state did not match.")
    clearUserAuthCookies(response)
    return response
  }

  try {
    await completeGitHubAppUserAuthorization({
      code,
    })
    if (installationId) {
      const installation = await verifyGitHubAppInstallation(installationId)
      await saveGitHubAppInstallation(installation)
    }
    await syncCurrentGitHubAppUserInstallations().catch(() => [])

    const redirectPath =
      next === "install"
        ? "/api/github/app/install"
        : next === "settings"
          ? "/?view=settings"
          : "/"
    const response = NextResponse.redirect(new URL(redirectPath, url.origin))
    clearUserAuthCookies(response)
    return response
  } catch (error) {
    const response = html(
      error instanceof Error
        ? error.message
        : "Unable to authorize GitHub user."
    )
    clearUserAuthCookies(response)
    return response
  }
}
