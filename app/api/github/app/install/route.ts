import { NextRequest, NextResponse } from "next/server"

import { getConvexAuthToken } from "@/lib/codex-auth"
import {
  createGitHubAppInstallUrl,
  createGitHubAppState,
  GITHUB_APP_STATE_COOKIE,
  getCurrentGitHubAppInstallations,
  getCurrentGitHubAppUserStatus,
  isGitHubAppConfigured,
  isGitHubAppUserAuthConfigured,
  syncCurrentGitHubAppUserInstallations,
} from "@/lib/github-app"
import { escapeHtml } from "@/lib/html-escape"

export const runtime = "nodejs"

function html(message: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Cloudcode GitHub App</title><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><h1 style="font-size:1.25rem">GitHub App installation could not start</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to Cloudcode</a></p></body>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      status: 400,
    }
  )
}

function getTargetId(url: URL) {
  const targetId = url.searchParams.get("targetId")?.trim()
  if (!targetId) return undefined
  if (!/^\d+$/.test(targetId)) {
    throw new Error("Invalid GitHub account target.")
  }
  return targetId
}

function getIntent(url: URL) {
  const intent = url.searchParams.get("intent")?.trim()
  if (!intent) return undefined
  if (intent !== "add-org") {
    throw new Error("Invalid GitHub App install intent.")
  }
  return intent
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const targetId = getTargetId(url)
    const intent = getIntent(url)
    const addOrg = intent === "add-org"
    const configure = addOrg || targetId !== undefined
    await getConvexAuthToken()

    if (!isGitHubAppConfigured()) {
      throw new Error(
        "Set GITHUB_APP_ID, GITHUB_APP_SLUG, and GITHUB_APP_PRIVATE_KEY_BASE64 before installing the GitHub App."
      )
    }

    if (!isGitHubAppUserAuthConfigured()) {
      throw new Error(
        "Set GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET before installing the GitHub App."
      )
    }

    const user = await getCurrentGitHubAppUserStatus()
    if (!user.connected) {
      return NextResponse.redirect(
        new URL("/api/github/app/oauth/login?next=install", url.origin)
      )
    }

    const state = createGitHubAppState()
    const installations = configure
      ? []
      : await syncCurrentGitHubAppUserInstallations()
          .then((synced) => synced)
          .catch(() => getCurrentGitHubAppInstallations())

    if (!configure && installations.length > 0) {
      return NextResponse.redirect(new URL("/?view=settings", url.origin))
    }

    const response = NextResponse.redirect(
      createGitHubAppInstallUrl({
        selectTarget: addOrg,
        state,
        targetId: targetId ?? (addOrg ? undefined : user.githubUserId),
      })
    )
    response.cookies.set(GITHUB_APP_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: 15 * 60,
      path: "/api/github/app",
      sameSite: "lax",
      secure: url.protocol === "https:",
    })

    return response
  } catch (error) {
    return html(
      error instanceof Error
        ? error.message
        : "Unable to start GitHub App installation."
    )
  }
}
