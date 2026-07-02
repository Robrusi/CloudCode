import type { CodexRunLog as RunCodexLog } from "@/lib/codex/run-log"
import { inlineToolMarker, shouldPersistRunLog } from "@/lib/codex/run-log"
import {
  appendWorkerRunLogs,
  isWorkerRunCanceledError,
  updateWorkerRunContent,
  type WorkerConvexClient,
  type WorkerRunPayload,
} from "@/lib/codex/run-worker"
import type { CodexRunStreamPublisher } from "@/lib/codex/run-stream"

// With a stream publisher the live UX comes from Redis; Convex checkpoints
// only serve reconnect recovery, so they can be an order of magnitude less
// frequent. Every flush rewrites the full checkpoint document, so cadence
// directly scales database bandwidth. Redis retains 4k entries for 6h, so a
// 15s-stale lastStreamId replays comfortably within the window.
const STREAM_LOG_BATCH_SIZE = 40
const STREAM_LOG_FLUSH_DELAY_MS = 15_000
const FALLBACK_LOG_BATCH_SIZE = 20
const FALLBACK_LOG_FLUSH_DELAY_MS = 1_000
const STREAM_CONTENT_FLUSH_CHAR_THRESHOLD = 32_768
const STREAM_CONTENT_FLUSH_DELAY_MS = 15_000
const FALLBACK_CONTENT_FLUSH_CHAR_THRESHOLD = 256
const FALLBACK_CONTENT_FLUSH_DELAY_MS = 500
const FINAL_FLUSH_TIMEOUT_MS = 5_000
const MUTATION_RETRY_DELAYS_MS = [100, 300, 900]

function sandboxIdFromLog(log: RunCodexLog) {
  if (log.kind !== "setup" || !log.detail) {
    return undefined
  }

  return log.message === "Daytona sandbox ready" ||
    log.message === "Recovered with a fresh Daytona sandbox"
    ? log.detail
    : undefined
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withMutationRetries<T>(
  label: string,
  operation: () => Promise<T>
) {
  const attemptOperation = async (attempt: number): Promise<T> => {
    try {
      return await operation()
    } catch (error) {
      if (isWorkerRunCanceledError(error)) throw error
      const delay = MUTATION_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) {
        throw error instanceof Error ? error : new Error(`Unable to ${label}.`)
      }
      await wait(delay)
      return attemptOperation(attempt + 1)
    }
  }

  return attemptOperation(0)
}

export function createLogBuffer(
  client: WorkerConvexClient,
  runId: WorkerRunPayload["runId"],
  onSandboxId: (sandboxId: string) => void,
  streamPublisher?: CodexRunStreamPublisher
) {
  const logBatchSize = streamPublisher
    ? STREAM_LOG_BATCH_SIZE
    : FALLBACK_LOG_BATCH_SIZE
  const logFlushDelayMs = streamPublisher
    ? STREAM_LOG_FLUSH_DELAY_MS
    : FALLBACK_LOG_FLUSH_DELAY_MS
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let flushPromise: Promise<void> | undefined
  let flushError: unknown
  const pending: Array<RunCodexLog & { time: number }> = []

  const clearFlushTimer = () => {
    if (!flushTimer) return
    clearTimeout(flushTimer)
    flushTimer = undefined
  }

  const flush = () => {
    if (flushPromise) return flushPromise
    clearFlushTimer()
    const logs = pending.splice(0, logBatchSize)
    if (logs.length === 0) return Promise.resolve()

    flushPromise = withMutationRetries("append run logs", () =>
      appendWorkerRunLogs(client, runId, logs)
    )
      .then(() => {
        flushError = undefined
      })
      .catch((error) => {
        flushError = error
        if (isWorkerRunCanceledError(error)) throw error
        pending.unshift(...logs)
        console.warn("Unable to append Codex run logs.", error)
        scheduleFlush()
      })
      .finally(() => {
        flushPromise = undefined
        if (flushError || pending.length === 0) return
        // Drain a full backlog immediately; otherwise wait out the cadence so
        // steady streaming can't chain flushes at round-trip rate.
        if (pending.length >= logBatchSize) {
          void flush().catch((error) => {
            flushError = error
          })
        } else scheduleFlush()
      })

    return flushPromise
  }

  const scheduleFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      void flush()
    }, logFlushDelayMs)
  }

  return {
    emit(log: RunCodexLog) {
      if (isWorkerRunCanceledError(flushError)) throw flushError
      const sandboxId = sandboxIdFromLog(log)
      if (sandboxId) onSandboxId(sandboxId)
      if (!shouldPersistRunLog(log)) return

      const storedLog = { ...log, time: Date.now() }
      streamPublisher?.publishLog(storedLog)
      pending.push(storedLog)
      if (sandboxId) {
        void flush().catch((error) => {
          flushError = error
        })
      } else if (pending.length >= logBatchSize) {
        void flush().catch((error) => {
          flushError = error
        })
      } else scheduleFlush()
    },
    async flush() {
      clearFlushTimer()
      const deadline = Date.now() + FINAL_FLUSH_TIMEOUT_MS

      const flushUntilDone = async (): Promise<void> => {
        if (isWorkerRunCanceledError(flushError)) throw flushError
        if ((pending.length === 0 && !flushPromise) || Date.now() >= deadline) {
          return
        }
        if (pending.length > 0) {
          void flush().catch((error) => {
            flushError = error
          })
        }
        await (flushPromise ?? Promise.resolve())
        return flushUntilDone()
      }

      if (pending.length === 0 && !flushPromise) {
        if (flushError) {
          throw flushError instanceof Error
            ? flushError
            : new Error("Unable to flush Codex run logs.")
        }
        return
      }

      return flushUntilDone().then(() => {
        if (pending.length > 0 || flushError) {
          throw flushError instanceof Error
            ? flushError
            : new Error("Unable to flush Codex run logs.")
        }
      })
    },
  }
}

export function createContentBuffer(
  client: WorkerConvexClient,
  runId: WorkerRunPayload["runId"],
  streamPublisher?: CodexRunStreamPublisher
) {
  const contentFlushCharThreshold = streamPublisher
    ? STREAM_CONTENT_FLUSH_CHAR_THRESHOLD
    : FALLBACK_CONTENT_FLUSH_CHAR_THRESHOLD
  const contentFlushDelayMs = streamPublisher
    ? STREAM_CONTENT_FLUSH_DELAY_MS
    : FALLBACK_CONTENT_FLUSH_DELAY_MS
  let content = ""
  let flushedContent = ""
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let flushPromise: Promise<void> | undefined
  let flushError: unknown

  const clearFlushTimer = () => {
    if (!flushTimer) return
    clearTimeout(flushTimer)
    flushTimer = undefined
  }

  const flush = () => {
    if (flushPromise) return flushPromise
    clearFlushTimer()
    if (content === flushedContent) return Promise.resolve()
    const snapshot = content
    const checkpoint =
      streamPublisher === undefined
        ? withMutationRetries("update run content", () =>
            updateWorkerRunContent(client, runId, snapshot)
          ).then(() => undefined)
        : streamPublisher
            .flush()
            .then(() =>
              withMutationRetries("update run content", () =>
                updateWorkerRunContent(
                  client,
                  runId,
                  snapshot,
                  streamPublisher.latestId
                )
              ).then(() => undefined)
            )

    flushPromise = checkpoint
      .then(() => {
        flushedContent = snapshot
        flushError = undefined
      })
      .catch((error) => {
        flushError = error
        if (isWorkerRunCanceledError(error)) return
        console.warn("Unable to update Codex run content.", error)
        scheduleFlush(500)
      })
      .finally(() => {
        flushPromise = undefined
        if (content === flushedContent || flushError) return
        // Flush a large backlog immediately; otherwise wait out the cadence so
        // steady streaming can't chain flushes at round-trip rate.
        if (
          content.length - flushedContent.length >=
          contentFlushCharThreshold
        ) {
          void flush().catch((error) => {
            flushError = error
          })
        } else scheduleFlush()
      })

    return flushPromise
  }

  const scheduleFlush = (delay = contentFlushDelayMs) => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      void flush().catch((error) => {
        flushError = error
      })
    }, delay)
  }

  const appendRaw = (value: string, options: { immediate?: boolean } = {}) => {
    if (isWorkerRunCanceledError(flushError)) throw flushError
    if (!value) return
    content += value
    streamPublisher?.publishContentDelta(value)
    if (
      options.immediate ||
      content.length - flushedContent.length >= contentFlushCharThreshold
    ) {
      void flush().catch((error) => {
        flushError = error
      })
    } else {
      scheduleFlush()
    }
  }

  return {
    append(delta: string) {
      appendRaw(delta)
    },
    appendToolLog(log: RunCodexLog) {
      appendRaw(inlineToolMarker(log) ?? "", { immediate: true })
    },
    get content() {
      return content
    },
    async flush() {
      clearFlushTimer()
      const deadline = Date.now() + FINAL_FLUSH_TIMEOUT_MS

      const flushUntilDone = async (): Promise<void> => {
        if (isWorkerRunCanceledError(flushError)) throw flushError
        if (
          (content === flushedContent && !flushPromise) ||
          Date.now() >= deadline
        ) {
          return
        }
        if (content !== flushedContent) {
          await flush()
        } else {
          await (flushPromise ?? Promise.resolve())
        }
        return flushUntilDone()
      }

      if (content === flushedContent && !flushPromise) {
        if (flushError) {
          throw flushError instanceof Error
            ? flushError
            : new Error("Unable to flush Codex run content.")
        }
        return
      }

      return flushUntilDone().then(() => {
        if (content !== flushedContent || flushError) {
          throw flushError instanceof Error
            ? flushError
            : new Error("Unable to flush Codex run content.")
        }
      })
    },
  }
}
