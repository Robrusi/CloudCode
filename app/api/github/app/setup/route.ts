import { NextRequest, NextResponse } from "next/server"

import {
  completeGitHubAppUserAuthorization,
  GITHUB_APP_STATE_COOKIE,
  GITHUB_APP_USER_NEXT_COOKIE,
  GITHUB_APP_USER_STATE_COOKIE,
  getCurrentGitHubAppUserStatus,
  isGitHubAppUserAuthConfigured,
  saveGitHubAppInstallation,
  syncCurrentGitHubAppUserInstallations,
  verifyGitHubAppInstallation,
} from "@/lib/github-app"
import { escapeHtml } from "@/lib/html-escape"

export const runtime = "nodejs"

function html(message: string, status = 400) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Cloudcode GitHub App</title><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><h1 style="font-size:1.25rem">GitHub App setup failed</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to Cloudcode</a></p></body>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      status,
    }
  )
}

function clearStateCookie(response: NextResponse) {
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

async function redirectAfterInstall(url: URL) {
  if (isGitHubAppUserAuthConfigured()) {
    const user = await getCurrentGitHubAppUserStatus()
    if (!user.connected) {
      return NextResponse.redirect(
        new URL("/api/github/app/oauth/login?next=settings", url.origin)
      )
    }
  }

  return NextResponse.redirect(new URL("/?view=settings", url.origin))
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const installationId = url.searchParams.get("installation_id")
  const returnedState = url.searchParams.get("state")
  const expectedInstallState = request.cookies.get(
    GITHUB_APP_STATE_COOKIE
  )?.value
  const expectedUserState = request.cookies.get(
    GITHUB_APP_USER_STATE_COOKIE
  )?.value

  if (
    !returnedState ||
    (returnedState !== expectedInstallState &&
      returnedState !== expectedUserState)
  ) {
    const response = html("GitHub App setup state did not match this session.")
    clearStateCookie(response)
    return response
  }

  try {
    if (code) {
      await completeGitHubAppUserAuthorization({ code })

      if (installationId) {
        const installation = await verifyGitHubAppInstallation(installationId)
        await saveGitHubAppInstallation(installation)
      }
      await syncCurrentGitHubAppUserInstallations().catch(() => [])

      const response = await redirectAfterInstall(url)
      clearStateCookie(response)
      return response
    }

    if (!installationId) {
      const response = html("Missing GitHub App installation id.")
      clearStateCookie(response)
      return response
    }

    const installation = await verifyGitHubAppInstallation(installationId)
    await saveGitHubAppInstallation(installation)
    await syncCurrentGitHubAppUserInstallations().catch(() => [])

    const response = await redirectAfterInstall(url)
    clearStateCookie(response)
    return response
  } catch (error) {
    const response = html(
      error instanceof Error
        ? error.message
        : "Unable to save GitHub App setup."
    )
    clearStateCookie(response)
    return response
  }
}
