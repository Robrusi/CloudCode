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
  terminalOperationErrorResponse,
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
    const githubAuth = githubAuthPromise
      ? await githubAuthPromise.then((credential) =>
          refreshDaytonaTerminalWebSocketGitHubAuth({
            githubToken: credential?.token,
            githubTokenExpiresAt: credential?.expiresAt,
            githubUserEmail: credential?.gitUserEmail,
            githubUserName: credential?.gitUserName,
            githubUsername: credential?.username,
            repoUrl: access.sandboxAccess.repoUrl,
            sandboxId,
            terminalId,
          })
        )
      : null

    const terminal = await prepareDaytonaTerminalWebSocket({
      cols,
      githubAuth,
      rows,
      sandboxId,
      terminalId,
    })

    void readDaytonaSandboxInfo(sandboxId)
      .then(observeCurrentUserDaytonaBillingInfo)
      .catch((error: unknown) => {
        console.warn("Unable to observe terminal sandbox billing.", error)
      })

    return NextResponse.json(terminal, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    return terminalOperationErrorResponse(
      error,
      "Unable to connect Daytona terminal."
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
    return terminalOperationErrorResponse(
      error,
      "Unable to resize Daytona terminal."
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

  try {
    await killDaytonaTerminal(sandboxId, terminalId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return terminalOperationErrorResponse(
      error,
      "Unable to delete Daytona terminal."
    )
  }
}
