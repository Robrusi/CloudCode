import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  codexRunStreamAvailable,
  readCodexRunStream,
} from "@/lib/codex/run-stream"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { searchStringParam } from "@/lib/http/api-route"
import type { StoredCodexRunLog } from "@/lib/codex/run-log"

export const runtime = "nodejs"
export const maxDuration = 300

const HEARTBEAT_INTERVAL_MS = 15_000
const STREAM_RECONNECT_AFTER_MS = 55_000
const XREAD_BLOCK_MS = 1_000

type StreamAccess = {
  checkpointContent: string
  lastStreamId?: string
  logs: StoredCodexRunLog[]
  runId: Id<"codexRuns">
  status: string
  threadId: Id<"threads">
} | null

function streamIdParts(value: string) {
  const [ms = "0", seq = "0"] = value.split("-", 2)
  const parsedMs = Number(ms)
  const parsedSeq = Number(seq)
  return [
    Number.isFinite(parsedMs) ? parsedMs : 0,
    Number.isFinite(parsedSeq) ? parsedSeq : 0,
  ] as const
}

function compareStreamIds(left: string | undefined, right: string | undefined) {
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1

  const leftParts = streamIdParts(left)
  const rightParts = streamIdParts(right)

  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]
    if (leftPart > rightPart) return 1
    if (leftPart < rightPart) return -1
  }

  return 0
}

function maxStreamId(left: string, right: string | undefined) {
  return compareStreamIds(left, right) >= 0 ? left : right!
}

function sseData(value: unknown, id?: string) {
  const prefix = id ? `id: ${id}\n` : ""
  return `${prefix}data: ${JSON.stringify(value)}\n\n`
}

function streamCursor(request: Request) {
  return (
    request.headers.get("last-event-id")?.trim() ||
    searchStringParam(request, "after") ||
    "0-0"
  )
}

export async function GET(request: Request) {
  const runId = searchStringParam(request, "runId") as
    | Id<"codexRuns">
    | undefined
  if (!runId) return new Response("runId required", { status: 400 })
  const checkedRunId = runId

  let access: StreamAccess
  let client: Awaited<ReturnType<typeof currentUserConvexHttpClient>>
  try {
    client = await currentUserConvexHttpClient()
    access = await client.query(api.codexRuns.streamAccess, {
      runId: checkedRunId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.includes("Sign in with Clerk")) {
      return new Response("Unauthorized.", { status: 401 })
    }
    console.warn("Unable to authorize Codex run stream.", error)
    return new Response("Unable to authorize run stream.", { status: 500 })
  }
  if (!access) return new Response("Run not found.", { status: 404 })

  const encoder = new TextEncoder()
  const requestedCursor = streamCursor(request)
  const checkpointCursor = access.lastStreamId
  const checkpointEventId =
    checkpointCursor && compareStreamIds(checkpointCursor, requestedCursor) >= 0
      ? checkpointCursor
      : undefined
  let closed = false
  let cursor = maxStreamId(requestedCursor, checkpointCursor)
  let lastHeartbeat = 0
  let receivedRedisEvent = false
  let sentCheckpointContentLength = access.checkpointContent.length
  let sentCheckpointLogsLength = access.logs.length
  let timeout: ReturnType<typeof setTimeout> | undefined
  let closeStream: (() => void) | undefined
  const startedAt = Date.now()

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

      function close() {
        if (closed) return
        closed = true
        if (timeout) clearTimeout(timeout)
        request.signal.removeEventListener("abort", close)
        try {
          controller.close()
        } catch {
          // The browser may already have closed the EventSource.
        }
      }
      closeStream = close

      async function tick() {
        if (closed) return
        if (Date.now() - startedAt >= STREAM_RECONNECT_AFTER_MS) {
          safeEnqueue(sseData({ type: "reconnect" }))
          close()
          return
        }

        if (!codexRunStreamAvailable()) {
          safeEnqueue(
            sseData({
              message:
                "Run streaming is not configured. Falling back to Convex checkpoints.",
              type: "unavailable",
            })
          )
          close()
          return
        }

        try {
          const entries = await readCodexRunStream({
            after: cursor,
            blockMs: XREAD_BLOCK_MS,
            runId: checkedRunId,
          })

          if (entries.length === 0 && !receivedRedisEvent) {
            const current = await client
              .query(api.codexRuns.streamAccess, { runId: checkedRunId })
              .catch((error) => {
                console.warn(
                  "Unable to check Codex run stream fallback.",
                  error
                )
                return null
              })

            if (
              current &&
              (current.checkpointContent.length > sentCheckpointContentLength ||
                current.logs.length > sentCheckpointLogsLength)
            ) {
              safeEnqueue(
                sseData({
                  message:
                    "Run stream has no Redis events. Falling back to Convex checkpoints.",
                  type: "unavailable",
                })
              )
              close()
              return
            }
          }

          for (const entry of entries) {
            receivedRedisEvent = true
            cursor = entry.id
            if (
              !safeEnqueue(
                sseData({ ...entry.event, streamId: entry.id }, entry.id)
              )
            ) {
              return
            }
            lastHeartbeat = Date.now()
            if (entry.event.type === "done" || entry.event.type === "error") {
              close()
              return
            }
          }

          if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
            lastHeartbeat = Date.now()
            if (!safeEnqueue(": heartbeat\n\n")) return
          }
        } catch (error) {
          safeEnqueue(
            sseData({
              message:
                error instanceof Error
                  ? error.message
                  : "Unable to read run stream.",
              type: "error",
            })
          )
          close()
          return
        }

        timeout = setTimeout(tick, 0)
      }

      request.signal.addEventListener("abort", close)
      safeEnqueue(
        sseData(
          {
            content: access.checkpointContent,
            logs: access.logs,
            status: access.status,
            streamId: access.lastStreamId,
            type: "checkpoint",
          },
          checkpointEventId
        )
      )
      sentCheckpointContentLength = access.checkpointContent.length
      sentCheckpointLogsLength = access.logs.length
      void tick()
    },
    cancel() {
      closeStream?.()
    },
  })

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  })
}
