import { readDaytonaSandboxInfo } from "@/lib/daytona-sandbox"

export const runtime = "nodejs"
export const maxDuration = 300

const STATUS_POLL_INTERVAL_MS = 1_000
const HEARTBEAT_INTERVAL_MS = 15_000

function streamEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  value: unknown
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")

  if (!sandboxId) {
    return new Response("sandboxId required", { status: 400 })
  }
  const checkedSandboxId = sandboxId

  const encoder = new TextEncoder()
  let closed = false
  let lastPayload = ""
  let lastHeartbeat = 0
  let timeout: ReturnType<typeof setTimeout> | undefined

  const stream = new ReadableStream({
    start(controller) {
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
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
          } else if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
            lastHeartbeat = Date.now()
            controller.enqueue(encoder.encode(": heartbeat\n\n"))
          }
        } catch (error) {
          streamEvent(controller, encoder, {
            error:
              error instanceof Error ? error.message : "Sandbox not found",
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
