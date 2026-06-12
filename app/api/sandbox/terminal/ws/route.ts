import { NextResponse } from "next/server"

import { observeCurrentUserDaytonaBillingInfo } from "@/lib/billing/server"
import {
  jsonError,
  jsonNumberField,
  jsonStringField,
  readJsonRecord,
  searchStringParam,
} from "@/lib/http/api-route"
import {
  daytonaTerminalHasCurrentGitHubAuth,
  killDaytonaTerminal,
} from "@/lib/daytona/terminal-sessions"
import {
  prepareDaytonaTerminalWebSocket,
  refreshDaytonaTerminalWebSocketGitHubAuth,
  resizeDaytonaTerminalWebSocket,
} from "@/lib/daytona/terminal-websocket"
import { readDaytonaSandboxInfo } from "@/lib/daytona/sandbox"
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
} from "@/lib/daytona/terminal-params"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github/auth"
import { requireSameOrigin } from "@/lib/http/request-security"
import {
  numberParam,
  requireTerminalAccess,
  terminalRequiredResponse,
} from "@/lib/sandbox/terminal-route"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const { searchParams } = new URL(request.url)
  const sandboxId = searchStringParam(request, "sandboxId")
  const terminalId = searchStringParam(request, "terminalId")
  const cols = numberParam(searchParams.get("cols"), TERMINAL_DEFAULT_COLS)
  const rows = numberParam(searchParams.get("rows"), TERMINAL_DEFAULT_ROWS)

  if (!sandboxId || !terminalId) {
    return terminalRequiredResponse()
  }

  const access = await requireTerminalAccess(sandboxId)
  if ("response" in access) return access.response

  try {
    const githubAuthPromise = daytonaTerminalHasCurrentGitHubAuth(
      sandboxId,
      terminalId
    )
      ? null
      : maybeGetCurrentGitHubRepoCredential(access.sandboxAccess.repoUrl)

    const terminal = await prepareDaytonaTerminalWebSocket({
      cols,
      rows,
      sandboxId,
      terminalId,
    })

    void readDaytonaSandboxInfo(sandboxId)
      .then(observeCurrentUserDaytonaBillingInfo)
      .catch((error: unknown) => {
        console.warn("Unable to observe terminal sandbox billing.", error)
      })

    if (githubAuthPromise) {
      void githubAuthPromise
        .then((githubAuth) =>
          refreshDaytonaTerminalWebSocketGitHubAuth({
            githubToken: githubAuth?.token,
            githubTokenExpiresAt: githubAuth?.expiresAt,
            githubUserEmail: githubAuth?.gitUserEmail,
            githubUserName: githubAuth?.gitUserName,
            githubUsername: githubAuth?.username,
            repoUrl: access.sandboxAccess.repoUrl,
            sandboxId,
            terminalId,
          })
        )
        .catch((error: unknown) => {
          console.warn("Unable to refresh terminal GitHub auth.", error)
        })
    }

    return NextResponse.json(terminal, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to connect Daytona terminal.",
      500
    )
  }
}

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const body = await readJsonRecord(request)
  const action = jsonStringField(body, "action")
  const sandboxId = jsonStringField(body, "sandboxId")
  const terminalId = jsonStringField(body, "terminalId")

  if (!sandboxId || !terminalId) {
    return terminalRequiredResponse()
  }

  const access = await requireTerminalAccess(sandboxId)
  if ("response" in access) return access.response

  if (action !== "resize") {
    return jsonError("Unsupported action.", 400)
  }

  try {
    await resizeDaytonaTerminalWebSocket({
      cols: jsonNumberField(body, "cols") ?? TERMINAL_DEFAULT_COLS,
      rows: jsonNumberField(body, "rows") ?? TERMINAL_DEFAULT_ROWS,
      sandboxId,
      terminalId,
    })
    void readDaytonaSandboxInfo(sandboxId)
      .then(observeCurrentUserDaytonaBillingInfo)
      .catch((error: unknown) => {
        console.warn("Unable to observe terminal resize billing.", error)
      })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to resize Daytona terminal.",
      500
    )
  }
}

export async function DELETE(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const body = await readJsonRecord(request)
  const sandboxId = jsonStringField(body, "sandboxId")
  const terminalId = jsonStringField(body, "terminalId")

  if (!sandboxId || !terminalId) {
    return terminalRequiredResponse()
  }

  const access = await requireTerminalAccess(sandboxId)
  if ("response" in access) return access.response

  await killDaytonaTerminal(sandboxId, terminalId)
  return NextResponse.json({ ok: true })
}
