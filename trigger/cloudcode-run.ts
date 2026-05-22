import { task, timeout } from "@trigger.dev/sdk"

import { ensureAutoEnvironmentSandbox } from "@/lib/sandbox-auto-environment"
import { runCodexInSandbox, type RunCodexLog } from "@/lib/daytona-codex-agent"
import { inlineToolMarker } from "@/lib/codex-run-log"
import {
  appendWorkerRunLogs,
  cancelWorkerRun,
  completeWorkerRun,
  failWorkerRun,
  getWorkerSecret,
  saveWorkerAuthJson,
  startAndLoadWorkerRun,
  updateWorkerRunContent,
  workerConvexClient,
  workerRunFinalContent,
  type WorkerRunPayload,
} from "@/lib/codex-run-worker"

const LOG_BATCH_SIZE = 20
const LOG_FLUSH_DELAY_MS = 350
const CONTENT_FLUSH_CHAR_THRESHOLD = 32
const CONTENT_FLUSH_DELAY_MS = 80
const FINAL_FLUSH_TIMEOUT_MS = 5_000
const MUTATION_RETRY_DELAYS_MS = [100, 300, 900]

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Codex run failed."
}

function sandboxIdFromLog(log: RunCodexLog) {
  if (log.kind !== "setup" || !log.detail || !/sandbox/i.test(log.message)) {
    return undefined
  }

  return log.detail
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withMutationRetries<T>(
  label: string,
  operation: () => Promise<T>
) {
  let lastError: unknown

  for (
    let attempt = 0;
    attempt <= MUTATION_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const delay = MUTATION_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await wait(delay)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Unable to ${label}.`)
}

function createLogBuffer(
  client: ReturnType<typeof workerConvexClient>,
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
      const sandboxId = sandboxIdFromLog(log)
      if (sandboxId) onSandboxId(sandboxId)

      pending.push({ ...log, time: Date.now() })
      if (pending.length >= LOG_BATCH_SIZE) {
        void flush().catch((error) => {
          flushError = error
        })
      } else scheduleFlush()
    },
    async flush() {
      clearFlushTimer()
      const deadline = Date.now() + FINAL_FLUSH_TIMEOUT_MS
      while ((pending.length > 0 || flushPromise) && Date.now() < deadline) {
        if (pending.length > 0) {
          void flush().catch((error) => {
            flushError = error
          })
        }
        await (flushPromise ?? Promise.resolve())
      }
      if (pending.length > 0 || flushError) {
        throw flushError instanceof Error
          ? flushError
          : new Error("Unable to flush Codex run logs.")
      }
    },
  }
}

function createContentBuffer(
  client: ReturnType<typeof workerConvexClient>,
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
      while (
        (content !== flushedContent || flushPromise) &&
        Date.now() < deadline
      ) {
        if (content !== flushedContent) {
          await flush()
        } else {
          await (flushPromise ?? Promise.resolve())
        }
      }
      if (content !== flushedContent || flushError) {
        throw flushError instanceof Error
          ? flushError
          : new Error("Unable to flush Codex run content.")
      }
    },
  }
}

export const cloudcodeRun = task({
  id: "cloudcode-run",
  retry: {
    maxAttempts: 1,
  },
  maxDuration: timeout.None,
  run: async (payload: WorkerRunPayload, { ctx, signal }) => {
    const client = workerConvexClient()
    let latestSandboxId: string | undefined
    const logBuffer = createLogBuffer(client, payload.runId, (sandboxId) => {
      latestSandboxId = sandboxId
    })
    const contentBuffer = createContentBuffer(client, payload.runId)

    try {
      const loaded = await startAndLoadWorkerRun(
        client,
        payload.runId,
        ctx.run.id
      )
      if (!loaded) return { canceled: true }

      let runInput = loaded.input
      let runAuthJson = loaded.authJson
      latestSandboxId = runInput.sandboxId

      if (runInput.sandboxPreset?.mode === "auto") {
        const autoEnvironment = await ensureAutoEnvironmentSandbox({
          authJson: runAuthJson,
          baseBranch: runInput.baseBranch,
          currentSandboxId: runInput.sandboxId,
          onLog: (log) => {
            contentBuffer.appendToolLog(log)
            logBuffer.emit(log)
          },
          repoUrl: runInput.repoUrl,
          sandboxPreset: runInput.sandboxPreset,
          signal,
          workerSecret: getWorkerSecret(),
        })

        runAuthJson = autoEnvironment.updatedAuthJson ?? runAuthJson
        runInput = {
          ...runInput,
          authJson: runAuthJson,
          preparedSandboxFresh: Boolean(autoEnvironment.preparedSandboxFresh),
          requireExistingSandbox: Boolean(
            autoEnvironment.requireExistingSandbox ||
            autoEnvironment.preparedSandboxFresh
          ),
          sandboxId: autoEnvironment.sandboxId ?? runInput.sandboxId,
          sandboxPreset: {
            ...runInput.sandboxPreset,
            ...autoEnvironment.preset,
          },
        }
        latestSandboxId = runInput.sandboxId
      }

      const result = await runCodexInSandbox({
        ...runInput,
        authJson: runAuthJson,
        onContentDelta: (delta) => contentBuffer.append(delta),
        onLog: (log) => {
          contentBuffer.appendToolLog(log)
          logBuffer.emit(log)
        },
        signal,
      })

      await Promise.all([logBuffer.flush(), contentBuffer.flush()])

      if (result.updatedAuthJson !== runAuthJson) {
        await saveWorkerAuthJson(
          loaded.userId,
          loaded.profile,
          result.updatedAuthJson
        )
      }

      const content = workerRunFinalContent(contentBuffer.content, result)
      await completeWorkerRun(client, payload.runId, content, result)

      return {
        canceled: false,
        exitCode: result.exitCode,
        sandboxId: result.sandboxId,
      }
    } catch (error) {
      await Promise.allSettled([logBuffer.flush(), contentBuffer.flush()])

      if (signal.aborted) {
        await cancelWorkerRun(client, payload.runId)
        return { canceled: true }
      }

      await failWorkerRun(
        client,
        payload.runId,
        errorMessage(error),
        latestSandboxId
      ).catch((failError) => {
        console.warn("Unable to mark Codex run failed.", failError)
      })
      throw error
    }
  },
  onCancel: async ({ payload }) => {
    await cancelWorkerRun(workerConvexClient(), payload.runId)
  },
})
