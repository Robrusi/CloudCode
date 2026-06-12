import type { CodexRunLog as RunCodexLog } from "@/lib/codex/run-log"
import { inlineToolMarker, shouldPersistRunLog } from "@/lib/codex/run-log"
import {
  appendWorkerRunLogs,
  isWorkerRunCanceledError,
  updateWorkerRunContent,
  type WorkerConvexClient,
  type WorkerRunPayload,
} from "@/lib/codex/run-worker"

const LOG_BATCH_SIZE = 20
const LOG_FLUSH_DELAY_MS = 350
const CONTENT_FLUSH_CHAR_THRESHOLD = 32
const CONTENT_FLUSH_DELAY_MS = 80
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
  onSandboxId: (sandboxId: string) => void
) {
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
    const logs = pending.splice(0, LOG_BATCH_SIZE)
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
        if (pending.length > 0 && !flushError) {
          void flush().catch((error) => {
            flushError = error
          })
        }
      })

    return flushPromise
  }

  const scheduleFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      void flush()
    }, LOG_FLUSH_DELAY_MS)
  }

  return {
    emit(log: RunCodexLog) {
      if (isWorkerRunCanceledError(flushError)) throw flushError
      const sandboxId = sandboxIdFromLog(log)
      if (sandboxId) onSandboxId(sandboxId)
      if (!shouldPersistRunLog(log)) return

      pending.push({ ...log, time: Date.now() })
      if (sandboxId) {
        void flush().catch((error) => {
          flushError = error
        })
      } else if (pending.length >= LOG_BATCH_SIZE) {
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
  runId: WorkerRunPayload["runId"]
) {
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

    flushPromise = withMutationRetries("update run content", () =>
      updateWorkerRunContent(client, runId, snapshot)
    )
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
        if (content !== flushedContent && !flushError) {
          scheduleFlush(0)
        }
      })

    return flushPromise
  }

  const scheduleFlush = (delay = CONTENT_FLUSH_DELAY_MS) => {
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
    if (
      options.immediate ||
      content.length - flushedContent.length >= CONTENT_FLUSH_CHAR_THRESHOLD
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
