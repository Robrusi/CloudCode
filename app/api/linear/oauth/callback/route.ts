import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { getIntegrationsBot } from "@/lib/integrations/bot"
import {
  LINEAR_OAUTH_STATE_COOKIE,
  linearIntegrationEnv,
} from "@/lib/integrations/config"
import { escapeHtml } from "@/lib/shared/html-escape"

export const runtime = "nodejs"

const SETTINGS_URL = "/?view=settings&section=connections"

function errorPage(message: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Cloudcode Linear</title><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><h1 style="font-size:1.25rem">Linear could not be connected</h1><p>${escapeHtml(message)}</p><p><a href="${SETTINGS_URL}">Return to settings</a></p></body>`,
    {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 400,
    }
  )
}

export async function GET(request: NextRequest) {
  if (!linearIntegrationEnv()) {
    return errorPage("The Linear integration is not configured.")
  }

  const url = new URL(request.url)
  const state = url.searchParams.get("state")
  const expectedState = request.cookies.get(LINEAR_OAUTH_STATE_COOKIE)?.value
  if (!state || !expectedState || state !== expectedState) {
    return errorPage("The authorization state did not match. Try again.")
  }

  try {
    const { linear } = getIntegrationsBot()
    if (!linear) {
      return errorPage("The Linear integration is not configured.")
    }

    // Exchanges the code and persists the per-organization installation
    // (tokens encrypted) in the Chat SDK state store.
    const { installation, organizationId } = await linear.handleOAuthCallback(
      request,
      { redirectUri: `${url.origin}/api/linear/oauth/callback` }
    )

    // Best effort: the organization name makes the settings tile readable.
    const organizationName = await linear
      .withInstallation(installation, async () => {
        const organization = await linear.linearClient.organization
        return organization.name
      })
      .catch(() => undefined)

    const client = await currentUserConvexHttpClient()
    await client.mutation(api.integrations.saveInstallation, {
      botUserId: installation.botUserId,
      externalId: organizationId,
      externalName: organizationName,
      provider: "linear",
    })

    const response = NextResponse.redirect(new URL(SETTINGS_URL, url.origin))
    response.cookies.set(LINEAR_OAUTH_STATE_COOKIE, "", {
      maxAge: 0,
      path: "/api/linear/oauth",
    })
    return response
  } catch (error) {
    console.error("/api/linear/oauth/callback failed", error)
    return errorPage(
      error instanceof Error ? error.message : "Authorization failed."
    )
  }
}
