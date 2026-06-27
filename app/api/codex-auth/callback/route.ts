import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function GET() {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Cloudcode Auth</title><body style="font-family:system-ui;padding:2rem;line-height:1.5;max-width:42rem"><h1 style="font-size:1.25rem">ChatGPT sign-in is waiting on the local callback</h1><p>Start ChatGPT sign-in from Cloudcode Settings. The browser will return to the temporary localhost callback opened for that sign-in attempt.</p><p><a href="/?view=settings">Open Settings</a></p></body>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      status: 400,
    }
  )
}
