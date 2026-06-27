import { NextRequest, NextResponse } from "next/server"

import { getConvexAuthToken } from "@/lib/codex/auth"
import {
  CODEX_DEVICE_AUTH_COOKIE,
  CODEX_DEVICE_AUTH_COOKIE_PATH,
  completeCodexDeviceLogin,
  decodeCodexDeviceLoginSession,
} from "@/lib/codex/oauth"
import { requireSameOrigin } from "@/lib/http/request-security"
import { escapeHtml } from "@/lib/shared/html-escape"

export const runtime = "nodejs"

function clearDeviceCookie(response: NextResponse) {
  response.cookies.set(CODEX_DEVICE_AUTH_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: CODEX_DEVICE_AUTH_COOKIE_PATH,
    sameSite: "lax",
  })
}

function getSession(request: NextRequest) {
  return decodeCodexDeviceLoginSession(
    request.cookies.get(CODEX_DEVICE_AUTH_COOKIE)?.value
  )
}

function devicePage({
  error,
  intervalSeconds,
  userCode,
  verificationUrl,
}: {
  error?: string
  intervalSeconds?: number
  userCode?: string
  verificationUrl?: string
}) {
  const escapedCode = userCode ? escapeHtml(userCode) : ""
  const escapedVerificationUrl = verificationUrl
    ? escapeHtml(verificationUrl)
    : ""
  const serializedIntervalMs = JSON.stringify(
    Math.max(1, intervalSeconds ?? 5) * 1000
  )
  const serializedHasSession = JSON.stringify(Boolean(userCode && !error))
  const serializedError = JSON.stringify(error ?? "")

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ChatGPT sign-in</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        align-items: center;
        background: #0d1117;
        color: #f0f6fc;
        display: flex;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
      }
      main {
        max-width: 34rem;
        padding: 2rem;
        text-align: center;
      }
      h1 {
        font-size: 1.35rem;
        margin: 0 0 0.75rem;
      }
      p {
        color: #c9d1d9;
        line-height: 1.55;
        margin: 0;
      }
      .code {
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 0.5rem;
        color: #f0f6fc;
        display: block;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: clamp(2rem, 8vw, 3.5rem);
        font-weight: 700;
        letter-spacing: 0.08em;
        margin: 1.5rem auto;
        padding: 1rem 1.25rem;
        width: fit-content;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        justify-content: center;
        margin-top: 1.5rem;
      }
      button,
      a.button {
        align-items: center;
        background: #f0f6fc;
        border: 0;
        border-radius: 0.5rem;
        color: #0d1117;
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-size: 0.92rem;
        font-weight: 650;
        justify-content: center;
        min-height: 2.5rem;
        padding: 0 1rem;
        text-decoration: none;
      }
      button.secondary {
        background: #21262d;
        color: #f0f6fc;
      }
      .status {
        color: #8b949e;
        font-size: 0.9rem;
        margin-top: 1.25rem;
      }
      .error {
        color: #ff7b72;
      }
    </style>
  </head>
  <body>
    <main>
      ${
        error
          ? `<h1>ChatGPT sign-in failed</h1><p class="error">${escapeHtml(
              error
            )}</p>`
          : `<h1>Enter this code in ChatGPT</h1>
      <p>Open ChatGPT, enter the code below, and approve Codex access. This window will update automatically when sign-in finishes.</p>
      <code class="code">${escapedCode}</code>
      <div class="actions">
        <a class="button" href="${escapedVerificationUrl}" target="_blank" rel="noopener noreferrer">Open ChatGPT</a>
        <button class="secondary" type="button" id="copy-code">Copy code</button>
      </div>
      <p class="status" id="status">Waiting for approval...</p>`
      }
    </main>
    <script>
      const hasSession = ${serializedHasSession};
      const intervalMs = ${serializedIntervalMs};
      const initialError = ${serializedError};
      const authMessageType = "cloudcode:codex-auth";
      const channelName = "cloudcode:codex-auth";
      const statusEl = document.getElementById("status");
      const copyButton = document.getElementById("copy-code");
      let settled = false;

      function notify(message) {
        if ("BroadcastChannel" in window) {
          const channel = new BroadcastChannel(channelName);
          channel.postMessage(message);
          channel.close();
        }
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(message, window.location.origin);
        }
      }

      function finish(message) {
        if (settled) return;
        settled = true;
        notify(message);
        if (statusEl) {
          statusEl.textContent =
            message.status === "complete"
              ? "Connected. You can close this window."
              : message.error || "ChatGPT sign-in failed.";
          statusEl.className =
            message.status === "complete" ? "status" : "status error";
        }
        if (message.status === "complete") {
          window.setTimeout(() => window.close(), 700);
        }
      }

      if (copyButton) {
        copyButton.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(${JSON.stringify(userCode ?? "")});
            copyButton.textContent = "Copied";
            window.setTimeout(() => {
              copyButton.textContent = "Copy code";
            }, 1400);
          } catch {
            copyButton.textContent = "Copy failed";
          }
        });
      }

      async function poll() {
        if (!hasSession || settled) return;

        try {
          const response = await fetch("/api/codex-auth/device", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "content-type": "application/json",
            },
            body: "{}",
          });
          const payload = await response.json().catch(() => ({}));

          if (!response.ok) {
            finish({
              error: payload.error || "ChatGPT sign-in failed.",
              status: "error",
              type: authMessageType,
            });
            return;
          }

          if (payload.status === "complete") {
            finish({ status: "complete", type: authMessageType });
            return;
          }

          window.setTimeout(poll, payload.retryAfterMs || intervalMs);
        } catch {
          window.setTimeout(poll, intervalMs);
        }
      }

      if (initialError) {
        finish({ error: initialError, status: "error", type: authMessageType });
      } else {
        window.setTimeout(poll, intervalMs);
      }
    </script>
  </body>
</html>`
}

function htmlResponse(html: string, status = 200) {
  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
    status,
  })
}

export async function GET(request: NextRequest) {
  const session = getSession(request)

  if (!session || session.expiresAt < Date.now()) {
    const response = htmlResponse(
      devicePage({
        error: "ChatGPT sign-in expired. Start sign-in again.",
      }),
      400
    )
    clearDeviceCookie(response)
    return response
  }

  return htmlResponse(
    devicePage({
      intervalSeconds: session.intervalSeconds,
      userCode: session.userCode,
      verificationUrl: session.verificationUrl,
    })
  )
}

export async function POST(request: NextRequest) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const session = getSession(request)
    if (!session) {
      return NextResponse.json(
        { error: "ChatGPT sign-in expired. Start sign-in again." },
        { status: 400 }
      )
    }

    const result = await completeCodexDeviceLogin({
      convexToken: await getConvexAuthToken(),
      session,
    })
    const response = NextResponse.json(result)

    if (result.status === "complete") {
      clearDeviceCookie(response)
    }

    return response
  } catch (error) {
    const response = NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "ChatGPT sign-in failed.",
      },
      { status: 400 }
    )
    clearDeviceCookie(response)
    return response
  }
}
