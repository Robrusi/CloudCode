import { NextResponse } from "next/server"

import {
  connectDaytonaTerminal,
  daytonaTerminalHasCurrentGitHubAuth,
  detachDaytonaTerminal,
  killDaytonaTerminal,
  refreshDaytonaTerminalGitHubAuth,
  resizeDaytonaTerminal,
  sendDaytonaTerminalInput,
  type ConnectedDaytonaTerminal,
} from "@/lib/daytona/terminal-sessions"
import { observeCurrentUserDaytonaBillingInfo } from "@/lib/billing/server"
import {
  jsonError,
  jsonNumberField,
  jsonStringField,
  readJsonRecord,
  searchStringParam,
} from "@/lib/http/api-route"
import { readDaytonaSandboxInfo } from "@/lib/daytona/sandbox"
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
} from "@/lib/daytona/terminal-params"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github/auth"
import { requireSameOrigin } from "@/lib/http/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox/authorization"
import {
  numberParam,
  requireTerminalAccess,
  terminalOperationErrorResponse,
  terminalRequiredResponse,
} from "@/lib/sandbox/terminal-route"

export const runtime = "nodejs"
export const maxDuration = 1800

function sse(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`
}

function terminalData(data: Uint8Array) {
  return {
    data: Buffer.from(data).toString("base64"),
    type: "data",
  }
}

type TerminalGitHubAuth = Awaited<
  ReturnType<typeof maybeGetCurrentGitHubRepoCredential>
>

async function refreshTerminalGitHubAuthFromCredential({
  githubAuth,
  repoUrl,
  sandboxId,
  terminalId,
}: {
  githubAuth: TerminalGitHubAuth
  repoUrl: string
  sandboxId: string
  terminalId: string
}) {
  await refreshDaytonaTerminalGitHubAuth({
    githubToken: githubAuth?.token,
    githubTokenExpiresAt: githubAuth?.expiresAt,
    githubUserEmail: githubAuth?.gitUserEmail,
    githubUserName: githubAuth?.gitUserName,
    githubUsername: githubAuth?.username,
    repoUrl,
    sandboxId,
    terminalId,
  })
}

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
  const { sandboxAccess } = access

  const encoder = new TextEncoder()
  let closed = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let terminalConnection: ConnectedDaytonaTerminal | undefined

  const stream = new ReadableStream({
    async start(controller) {
      function enqueue(value: unknown) {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(sse(value)))
        } catch {
          closed = true
        }
      }

      try {
        const githubAuth = daytonaTerminalHasCurrentGitHubAuth(
          sandboxId,
          terminalId
        )
          ? null
          : await maybeGetCurrentGitHubRepoCredential(sandboxAccess.repoUrl)
        const connection = await connectDaytonaTerminal({
          cols,
          githubToken: githubAuth?.token,
          githubTokenExpiresAt: githubAuth?.expiresAt,
          githubUserEmail: githubAuth?.gitUserEmail,
          githubUserName: githubAuth?.gitUserName,
          githubUsername: githubAuth?.username,
          onData: (data) => {
            enqueue(terminalData(data))
          },
          repoUrl: sandboxAccess.repoUrl,
          rows,
          sandboxId,
          terminalId,
        })
        terminalConnection = connection
        await readDaytonaSandboxInfo(sandboxId)
          .then(observeCurrentUserDaytonaBillingInfo)
          .catch((error: unknown) => {
            console.warn("Unable to observe terminal sandbox billing.", error)
          })

        if (closed) {
          await detachDaytonaTerminal(
            sandboxId,
            terminalId,
            terminalConnection.subscriber
          )
          return
        }

        for (const data of connection.replay) {
          enqueue(terminalData(data))
        }
        if (closed) {
          await detachDaytonaTerminal(
            sandboxId,
            terminalId,
            terminalConnection.subscriber
          )
          return
        }

        connection.activate()
        enqueue({ type: "ready" })
        heartbeat = setInterval(() => enqueue({ type: "ping" }), 20_000)
      } catch (error) {
        enqueue({
          error:
            error instanceof Error
              ? error.message
              : "Unable to connect Daytona terminal.",
          type: "error",
        })
        closed = true
        controller.close()
      }
    },
    async cancel() {
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      if (terminalConnection) {
        await detachDaytonaTerminal(
          sandboxId,
          terminalId,
          terminalConnection.subscriber
        )
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  })
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
  const { sandboxAccess } = access

  try {
    if (
      action !== "resize" &&
      !daytonaTerminalHasCurrentGitHubAuth(sandboxId, terminalId)
    ) {
      const githubAuth = await maybeGetCurrentGitHubRepoCredential(
        sandboxAccess.repoUrl
      )
      await refreshTerminalGitHubAuthFromCredential({
        githubAuth,
        repoUrl: sandboxAccess.repoUrl,
        sandboxId,
        terminalId,
      })
    }

    if (action === "resize") {
      await resizeDaytonaTerminal({
        cols: jsonNumberField(body, "cols") ?? TERMINAL_DEFAULT_COLS,
        rows: jsonNumberField(body, "rows") ?? TERMINAL_DEFAULT_ROWS,
        sandboxId,
        terminalId,
      })
      await readDaytonaSandboxInfo(sandboxId)
        .then(observeCurrentUserDaytonaBillingInfo)
        .catch((error: unknown) => {
          console.warn("Unable to observe terminal resize billing.", error)
        })
      return NextResponse.json({ ok: true })
    }

    if (typeof body.data !== "string") {
      return jsonError("data required", 400)
    }

    await sendDaytonaTerminalInput({
      data: body.data,
      sandboxId,
      terminalId,
    })
    await readDaytonaSandboxInfo(sandboxId)
      .then(observeCurrentUserDaytonaBillingInfo)
      .catch((error: unknown) => {
        console.warn("Unable to observe terminal input billing.", error)
      })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return terminalOperationErrorResponse(error, "Terminal command failed.")
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

  try {
    await requireCurrentUserSandbox(sandboxId)
  } catch {
    return jsonError("Sandbox not found.", 404)
  }

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
