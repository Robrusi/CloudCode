import { NextResponse } from "next/server"

const CODEX_OAUTH_STATE_COOKIE = "cloudcode_codex_oauth_state"
const CODEX_OAUTH_STATE_COOKIE_PATH = "/api/codex-auth"

export function codexAuthDisabledResponse({
  clearOAuthState = false,
}: { clearOAuthState?: boolean } = {}) {
  const response = new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Cloudcode Auth</title><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><h1 style="font-size:1.25rem">ChatGPT sign-in is disabled</h1><p>Import auth.json in Cloudcode Settings to authorize Codex runs.</p><p><a href="/?view=settings">Open Settings</a></p></body>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      status: 410,
    }
  )

  if (clearOAuthState) {
    response.cookies.set(CODEX_OAUTH_STATE_COOKIE, "", {
      maxAge: 0,
      path: CODEX_OAUTH_STATE_COOKIE_PATH,
    })
  }

  return response
}
