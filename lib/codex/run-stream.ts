import type { Id } from "@/convex/_generated/dataModel"
import type { StoredCodexRunLog } from "@/lib/codex/run-log"
import {
  isUpstashRedisConfigured,
  upstashRedisCommand,
} from "@/lib/redis/upstash"

const RUN_STREAM_PREFIX = "codex-run-stream"
const RUN_STREAM_TTL_SECONDS = 6 * 60 * 60
const RUN_STREAM_TTL_REFRESH_MS = 60_000
const RUN_STREAM_MAXLEN = 4_000
const DEFAULT_XREAD_BLOCK_MS = 5_000
const DEFAULT_XREAD_COUNT = 100
const PUBLISH_BATCH_DELAY_MS = 16
const PUBLISH_CONTENT_CHAR_THRESHOLD = 512
const PUBLISH_MAX_BATCH_EVENTS = 32

const ttlRefreshes = new Map<string, number>()

export type CodexRunStreamEvent =
  | {
      delta: string
      seq: number
      time: number
      type: "content_delta"
    }
  | {
      log: StoredCodexRunLog
      seq: number
      time: number
      type: "log"
    }
  | {
      seq: number
      status: string
      time: number
      type: "done"
    }
  | {
      message: string
      seq: number
      time: number
      type: "error"
    }

export type CodexRunStreamEntry = {
  event: CodexRunStreamEvent
  id: string
}

export type CodexRunStreamPublisher = ReturnType<
  typeof createCodexRunStreamPublisher
>

type PendingCodexRunStreamEvent =
  | Omit<
      Extract<CodexRunStreamEvent, { type: "content_delta" }>,
      "seq" | "time"
    >
  | Omit<Extract<CodexRunStreamEvent, { type: "log" }>, "seq" | "time">
  | Omit<Extract<CodexRunStreamEvent, { type: "done" }>, "seq" | "time">
  | Omit<Extract<CodexRunStreamEvent, { type: "error" }>, "seq" | "time">

type RawXReadResponse = null | Array<
  [string, Array<[string, Array<string | number>] | unknown>]
>

export function codexRunStreamAvailable() {
  return isUpstashRedisConfigured()
}

export function codexRunStreamKey(runId: Id<"codexRuns"> | string) {
  return `${RUN_STREAM_PREFIX}:${runId}`
}

function shouldRefreshTtl(key: string) {
  const now = Date.now()
  const lastRefresh = ttlRefreshes.get(key) ?? 0
  if (now - lastRefresh < RUN_STREAM_TTL_REFRESH_MS) return false
  ttlRefreshes.set(key, now)
  return true
}

function fieldValue(fields: unknown, name: string) {
  if (!Array.isArray(fields)) return undefined

  for (let index = 0; index < fields.length - 1; index += 2) {
    if (fields[index] === name) {
      const value = fields[index + 1]
      return typeof value === "string" ? value : String(value)
    }
  }

  return undefined
}

function parseStreamEntry(entry: unknown): CodexRunStreamEntry | null {
  if (
    !Array.isArray(entry) ||
    entry.length < 2 ||
    typeof entry[0] !== "string"
  ) {
    return null
  }

  const payload = fieldValue(entry[1], "payload")
  if (!payload) return null

  try {
    return {
      event: JSON.parse(payload) as CodexRunStreamEvent,
      id: entry[0],
    }
  } catch {
    return null
  }
}

export async function appendCodexRunStreamEvent(
  runId: Id<"codexRuns"> | string,
  event: CodexRunStreamEvent
) {
  const key = codexRunStreamKey(runId)
  const id = await upstashRedisCommand<string>([
    "XADD",
    key,
    "MAXLEN",
    "~",
    RUN_STREAM_MAXLEN,
    "*",
    "payload",
    JSON.stringify(event),
  ])
  if (shouldRefreshTtl(key)) {
    upstashRedisCommand<number>(["EXPIRE", key, RUN_STREAM_TTL_SECONDS]).catch(
      (error) => {
        console.warn("Unable to refresh Codex run stream TTL.", error)
      }
    )
  }
  return id
}

export function createCodexRunStreamPublisher(runId: Id<"codexRuns"> | string) {
  let latestId: string | undefined
  let publishFailed = false
  let publishTimer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  let pendingContentChars = 0
  let seq = 0
  const pending: PendingCodexRunStreamEvent[] = []

  const clearPublishTimer = () => {
    if (!publishTimer) return
    clearTimeout(publishTimer)
    publishTimer = undefined
  }

  const schedulePublish = (delay = PUBLISH_BATCH_DELAY_MS) => {
    if (publishTimer) return
    publishTimer = setTimeout(() => {
      publishTimer = undefined
      void drain()
    }, delay)
  }

  const appendPending = (event: PendingCodexRunStreamEvent) => {
    if (event.type === "content_delta") {
      pendingContentChars += event.delta.length
      const last = pending[pending.length - 1]
      if (last?.type === "content_delta") {
        last.delta += event.delta
        return
      }
    }

    pending.push(event)
  }

  const nextBatch = () => {
    const events = pending.splice(0, PUBLISH_MAX_BATCH_EVENTS)
    pendingContentChars = pending.reduce(
      (total, event) =>
        event.type === "content_delta" ? total + event.delta.length : total,
      0
    )
    return events.map(
      (event) =>
        ({
          ...event,
          seq: ++seq,
          time: Date.now(),
        }) as CodexRunStreamEvent
    )
  }

  const drain = () => {
    if (inFlight) return inFlight
    clearPublishTimer()
    const batch = nextBatch()
    if (batch.length === 0) return Promise.resolve()

    inFlight = (async () => {
      for (const event of batch) {
        latestId = await appendCodexRunStreamEvent(runId, event)
      }
    })()
      .catch((error) => {
        if (!publishFailed) {
          publishFailed = true
          console.warn("Unable to publish Codex run stream event.", error)
        }
      })
      .finally(() => {
        inFlight = undefined
        if (pending.length > 0) schedulePublish(0)
      })

    return inFlight
  }

  const publish = (
    event: PendingCodexRunStreamEvent,
    options: { immediate?: boolean } = {}
  ) => {
    if (!codexRunStreamAvailable()) return
    appendPending(event)
    if (
      options.immediate ||
      pending.length >= PUBLISH_MAX_BATCH_EVENTS ||
      pendingContentChars >= PUBLISH_CONTENT_CHAR_THRESHOLD
    ) {
      void drain()
    } else {
      schedulePublish()
    }
  }

  return {
    async flush() {
      clearPublishTimer()
      while (pending.length > 0 || inFlight) {
        if (!inFlight && pending.length > 0) {
          void drain()
        }
        await (inFlight ?? Promise.resolve())
      }
    },
    get latestId() {
      return latestId
    },
    publishContentDelta(delta: string) {
      if (delta) publish({ delta, type: "content_delta" })
    },
    publishDone(status: string) {
      publish({ status, type: "done" }, { immediate: true })
    },
    publishError(message: string) {
      publish({ message, type: "error" }, { immediate: true })
    },
    publishLog(log: StoredCodexRunLog) {
      publish({ log, type: "log" })
    },
  }
}

export async function readCodexRunStream({
  after,
  blockMs = DEFAULT_XREAD_BLOCK_MS,
  count = DEFAULT_XREAD_COUNT,
  runId,
}: {
  after: string
  blockMs?: number
  count?: number
  runId: Id<"codexRuns"> | string
}) {
  const result = await upstashRedisCommand<RawXReadResponse>(
    [
      "XREAD",
      "BLOCK",
      blockMs,
      "COUNT",
      count,
      "STREAMS",
      codexRunStreamKey(runId),
      after,
    ],
    undefined,
    { timeoutMs: blockMs + 5_000 }
  )
  if (!result?.length) return []

  return result.flatMap((stream) => {
    const entries = Array.isArray(stream[1]) ? stream[1] : []
    return entries.flatMap((entry) => {
      const parsed = parseStreamEntry(entry)
      return parsed ? [parsed] : []
    })
  })
}

export async function deleteCodexRunStream(runId: Id<"codexRuns"> | string) {
  if (!codexRunStreamAvailable()) return
  await upstashRedisCommand<number>(["DEL", codexRunStreamKey(runId)]).catch(
    (error) => {
      console.warn("Unable to delete Codex run stream.", error)
    }
  )
}
