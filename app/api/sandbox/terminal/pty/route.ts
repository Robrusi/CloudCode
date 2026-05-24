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
} from "@/lib/daytona-terminal-sessions"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github-auth"
import { requireSameOrigin } from "@/lib/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox-authorization"

export const runtime = "nodejs"
export const maxDuration = 3600

function sse(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`
}

function terminalData(data: Uint8Array) {
  return {
    data: Buffer.from(data).toString("base64"),
    type: "data",
  }
}

function numberParam(value: string | null, fallback: number) {
  if (!value) return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")
  const terminalId = searchParams.get("terminalId")
  const cols = numberParam(searchParams.get("cols"), 100)
  const rows = numberParam(searchParams.get("rows"), 30)

  if (!sandboxId || !terminalId) {
    return NextResponse.json(
      { error: "sandboxId and terminalId required" },
      { status: 400 }
    )
  }

  let sandboxAccess: Awaited<ReturnType<typeof requireCurrentUserSandbox>>
  try {
    sandboxAccess = await requireCurrentUserSandbox(sandboxId)
  } catch {
    return NextResponse.json({ error: "Sandbox not found." }, { status: 404 })
  }

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
        const githubAuth = await maybeGetCurrentGitHubRepoCredential(
          sandboxAccess.repoUrl
        )
        const connection = await connectDaytonaTerminal({
          cols,
          githubToken: githubAuth?.token,
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

  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown
    cols?: unknown
    data?: unknown
    rows?: unknown
    sandboxId?: unknown
    terminalId?: unknown
  }
  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : ""
  const terminalId = typeof body.terminalId === "string" ? body.terminalId : ""

  if (!sandboxId || !terminalId) {
    return NextResponse.json(
      { error: "sandboxId and terminalId required" },
      { status: 400 }
    )
  }

  let sandboxAccess: Awaited<ReturnType<typeof requireCurrentUserSandbox>>
  try {
    sandboxAccess = await requireCurrentUserSandbox(sandboxId)
  } catch {
    return NextResponse.json({ error: "Sandbox not found." }, { status: 404 })
  }

  try {
    if (
      body.action !== "resize" &&
      !daytonaTerminalHasCurrentGitHubAuth(sandboxId, terminalId)
    ) {
      const githubAuth = await maybeGetCurrentGitHubRepoCredential(
        sandboxAccess.repoUrl
      )
      await refreshDaytonaTerminalGitHubAuth({
        githubToken: githubAuth?.token,
        githubUserEmail: githubAuth?.gitUserEmail,
        githubUserName: githubAuth?.gitUserName,
        githubUsername: githubAuth?.username,
        repoUrl: sandboxAccess.repoUrl,
        sandboxId,
        terminalId,
      })
    }

    if (body.action === "resize") {
      await resizeDaytonaTerminal({
        cols: typeof body.cols === "number" ? body.cols : 100,
        rows: typeof body.rows === "number" ? body.rows : 30,
        sandboxId,
        terminalId,
      })
      return NextResponse.json({ ok: true })
    }

    if (typeof body.data !== "string") {
      return NextResponse.json({ error: "data required" }, { status: 400 })
    }

    await sendDaytonaTerminalInput({
      data: body.data,
      sandboxId,
      terminalId,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Terminal command failed.",
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const body = (await request.json().catch(() => ({}))) as {
    sandboxId?: unknown
    terminalId?: unknown
  }
  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : ""
  const terminalId = typeof body.terminalId === "string" ? body.terminalId : ""

  if (!sandboxId || !terminalId) {
    return NextResponse.json(
      { error: "sandboxId and terminalId required" },
      { status: 400 }
    )
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
  } catch {
    return NextResponse.json({ error: "Sandbox not found." }, { status: 404 })
  }

  await killDaytonaTerminal(sandboxId, terminalId)
  return NextResponse.json({ ok: true })
}
