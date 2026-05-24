import { readDaytonaSandboxInfo } from "@/lib/daytona-sandbox"
import { requireCurrentUserSandbox } from "@/lib/sandbox-authorization"

export const runtime = "nodejs"
export const maxDuration = 300

const STATUS_POLL_INTERVAL_MS = 1_000
const HEARTBEAT_INTERVAL_MS = 15_000

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")

  if (!sandboxId) {
    return new Response("sandboxId required", { status: 400 })
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
  } catch {
    return new Response("Sandbox not found.", { status: 404 })
  }

  const checkedSandboxId = sandboxId

  const encoder = new TextEncoder()
  let closed = false
  let lastPayload = ""
  let lastHeartbeat = 0
  let timeout: ReturnType<typeof setTimeout> | undefined

  const stream = new ReadableStream({
    start(controller) {
      function safeEnqueue(chunk: string) {
        if (closed) return false
        try {
          controller.enqueue(encoder.encode(chunk))
          return true
        } catch {
          close()
          return false
        }
      }

      function safeStreamEvent(value: unknown) {
        return safeEnqueue(`data: ${JSON.stringify(value)}\n\n`)
      }

      function close() {
        if (closed) return
        closed = true
        if (timeout) clearTimeout(timeout)
        try {
          controller.close()
        } catch {
          // The browser may have already closed the EventSource.
        }
      }

      async function tick() {
        if (closed) return

        try {
          const info = await readDaytonaSandboxInfo(checkedSandboxId)
          const payload = JSON.stringify({ type: "status", ...info })
          if (payload !== lastPayload) {
            lastPayload = payload
            lastHeartbeat = Date.now()
            if (!safeEnqueue(`data: ${payload}\n\n`)) return
          } else if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
            lastHeartbeat = Date.now()
            if (!safeEnqueue(": heartbeat\n\n")) return
          }
        } catch (error) {
          safeStreamEvent({
            error: error instanceof Error ? error.message : "Sandbox not found",
            notFound: true,
            sandboxId: checkedSandboxId,
            state: "deleted",
            type: "status",
          })
          close()
          return
        }

        timeout = setTimeout(tick, STATUS_POLL_INTERVAL_MS)
      }

      request.signal.addEventListener("abort", close)
      void tick()
    },
    cancel() {
      closed = true
      if (timeout) clearTimeout(timeout)
    },
  })

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": "text/event-stream; charset=utf-8",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}
