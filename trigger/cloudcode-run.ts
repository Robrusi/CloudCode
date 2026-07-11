import { schedules, task, tasks, timeout } from "@trigger.dev/sdk"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { redactCodexAuthPayloads } from "@/lib/codex/auth-redaction"
import { ensureAutoEnvironmentSandbox } from "@/lib/sandbox/auto-environment"
import { deleteWorkerDaytonaSandbox } from "@/lib/sandbox/delete"
import { runCodexInSandbox } from "@/lib/daytona/codex-agent"
import { codexAppServerRunUpdatedAuthJson } from "@/lib/daytona/codex-app-server-run"
import {
  CODEX_AUTH_RECONNECT_MESSAGE,
  isCodexRefreshTokenReusedError,
  isCodexRefreshTokenReusedRunResult,
} from "@/lib/codex/auth-errors"
import {
  cancelWorkerRun,
  completeWorkerRun,
  failWorkerRun,
  getWorkerSecret,
  invalidateWorkerAuthProfile,
  isWorkerRunCanceledError,
  refreshWorkerAuthForRun,
  saveWorkerAuthJson,
  startAndLoadWorkerRun,
  syncWorkerMcpServerTools,
  workerConvexClient,
  workerRunFinalContent,
  type WorkerRunPayload,
} from "@/lib/codex/run-worker"
import {
  createContentBuffer,
  createLogBuffer,
} from "@/trigger/cloudcode-run-buffers"
import {
  codexRunStreamAvailable,
  createCodexRunStreamPublisher,
} from "@/lib/codex/run-stream"
import { notifyIntegrationRunFinished } from "@/lib/integrations/notify"
import {
  createBillingAbortController,
  createTriggerUsageMeter,
  observeActiveBillingSandboxSegment,
  observeSandboxBilling,
  pauseSandboxForBilling,
  type ActiveBillingSandboxSegment,
} from "@/trigger/cloudcode-run-billing"
import type { factoryDispatch } from "@/trigger/factory"

function errorMessage(error: unknown) {
  return redactCodexAuthPayloads(
    error instanceof Error ? error.message : "Codex run failed."
  )
}

type FactoryWakeRunRef = {
  runId: Id<"codexRuns">
  threadId: Id<"threads">
  userId: Id<"users">
}

/** Factory wake-up runs created by the terminal-status mutations sit queued
 * until a factory-dispatch task picks them up; queue one per created run. */
async function queueFactoryWakeRuns(wakeRuns?: FactoryWakeRunRef[]) {
  for (const wake of wakeRuns ?? []) {
    await tasks
      .trigger<typeof factoryDispatch>(
        "factory-dispatch",
        { runId: wake.runId },
        {
          idempotencyKey: `factory-dispatch:${wake.runId}`,
          tags: [`user:${wake.userId}`, `thread:${wake.threadId}`],
        }
      )
      .catch((error) => {
        console.warn("Unable to queue factory wake-up run.", error)
      })
  }
}

class CodexAuthReconnectHandledError extends Error {
  constructor() {
    super(CODEX_AUTH_RECONNECT_MESSAGE)
    this.name = "CodexAuthReconnectHandledError"
  }
}

async function failCodexAuthReconnectRun({
  client,
  profile,
  runId,
  sandboxId,
  userId,
}: {
  client: ReturnType<typeof workerConvexClient>
  profile?: string
  runId: Id<"codexRuns">
  sandboxId?: string
  userId?: Id<"users">
}) {
  if (userId && profile) {
    await invalidateWorkerAuthProfile(
      userId,
      profile,
      "refresh_token_reused"
    ).catch((authError) => {
      console.warn("Unable to invalidate Codex auth profile.", authError)
    })
  } else {
    console.warn("Unable to invalidate Codex auth profile: missing profile.")
  }

  const failResponse = await failWorkerRun(
    client,
    runId,
    CODEX_AUTH_RECONNECT_MESSAGE,
    sandboxId
  ).catch((failError) => {
    console.warn("Unable to mark Codex run failed.", failError)
    return undefined
  })
  await queueFactoryWakeRuns(failResponse?.factoryWakeRuns)
}

export const billingReconcileDaytonaSandboxes = schedules.task({
  id: "billing-reconcile-daytona-sandboxes",
  cron: "*/1 * * * *",
  retry: {
    maxAttempts: 1,
  },
  run: async () => {
    const client = workerConvexClient()
    const activeSegments = (await client.query(
      api.billing.activeDaytonaSegmentsForWorker,
      {
        limit: 200,
        workerSecret: getWorkerSecret(),
      }
    )) as ActiveBillingSandboxSegment[]
    const latestBySandbox = new Map<string, ActiveBillingSandboxSegment>()

    for (const segment of activeSegments) {
      latestBySandbox.set(segment.sandboxId, segment)
    }

    let observed = 0
    let paused = 0
    for (const segment of latestBySandbox.values()) {
      const result = await observeActiveBillingSandboxSegment({
        client,
        segment,
      })
      if (result.exhausted) {
        const pause = await pauseSandboxForBilling({
          client,
          sandboxId: segment.sandboxId,
          userId: segment.userId,
        }).catch((error) => {
          console.warn("Unable to pause exhausted billing sandbox.", error)
          return { paused: false }
        })
        if (pause.paused) paused += 1
      }
      observed += 1
    }

    await client.action(api.billing.retryFailedUsageForWorker, {
      limit: 50,
      workerSecret: getWorkerSecret(),
    })

    return { observed, paused }
  },
})

export const cloudcodeRun = task({
  id: "cloudcode-run",
  retry: {
    maxAttempts: 1,
  },
  maxDuration: timeout.None,
  run: async (payload: WorkerRunPayload, { ctx, signal }) => {
    const client = workerConvexClient()
    const billingAbort = createBillingAbortController(signal)
    let billingError: unknown
    let latestSandboxId: string | undefined
    let loadedEphemeral = false
    let loadedUserId: Id<"users"> | undefined
    let usageMeter: ReturnType<typeof createTriggerUsageMeter> | undefined
    let billingPauseSandboxId: string | undefined
    let billingPausePromise: Promise<void> | undefined
    let loadedProfile: string | undefined
    let runAuthFingerprint: string | undefined
    let runAuthJson: string | undefined
    const sandboxObservations = new Map<string, Promise<void>>()
    const failBilling = (error: unknown) => {
      billingError = billingError ?? error
      billingAbort.abort(error)
    }
    const throwIfBillingFailed = () => {
      if (billingError) {
        throw billingError instanceof Error
          ? billingError
          : new Error("Billing failed.")
      }
    }
    const pauseLatestSandboxForBilling = (sandboxId = latestSandboxId) => {
      if (!sandboxId || !loadedUserId) return Promise.resolve()
      if (billingPausePromise && billingPauseSandboxId === sandboxId) {
        return billingPausePromise
      }
      billingPauseSandboxId = sandboxId
      billingPausePromise = pauseSandboxForBilling({
        client,
        sandboxId,
        userId: loadedUserId,
      })
        .then(() => undefined)
        .finally(() => {
          billingPausePromise = undefined
        })
      return billingPausePromise
    }
    const handleBillingExhausted = async (sandboxId = latestSandboxId) => {
      await pauseLatestSandboxForBilling(sandboxId)
      throw new Error(
        "Infrastructure usage is exhausted. The Daytona sandbox was paused."
      )
    }
    const observeSandbox = (sandboxId: string) => {
      if (!loadedUserId || sandboxObservations.has(sandboxId)) return
      const observation = observeSandboxBilling({
        client,
        sandboxId,
        source: "observed",
        userId: loadedUserId,
      })
        .then(async (result) => {
          if (result.exhausted) await handleBillingExhausted(sandboxId)
        })
        .catch((error) => {
          failBilling(error)
          throw error
        })
      sandboxObservations.set(sandboxId, observation)
    }
    const streamPublisher = codexRunStreamAvailable()
      ? createCodexRunStreamPublisher(payload.runId)
      : undefined
    const logBuffer = createLogBuffer(
      client,
      payload.runId,
      (sandboxId) => {
        latestSandboxId = sandboxId
        observeSandbox(sandboxId)
      },
      streamPublisher
    )
    const contentBuffer = createContentBuffer(
      client,
      payload.runId,
      streamPublisher
    )

    try {
      const loaded = await startAndLoadWorkerRun(
        client,
        payload.runId,
        ctx.run.id
      )
      if (!loaded) return { canceled: true }

      loadedEphemeral = loaded.ephemeralSandbox
      loadedUserId = loaded.userId
      loadedProfile = loaded.profile
      runAuthFingerprint = loaded.authFingerprint
      usageMeter = createTriggerUsageMeter({
        client,
        failBilling,
        onExhausted: () => handleBillingExhausted(),
        triggerRunId: ctx.run.id,
        userId: loaded.userId,
      })
      await usageMeter.flush("started")

      let runInput = loaded.input
      runAuthJson = loaded.authJson
      latestSandboxId = runInput.sandboxId
      if (latestSandboxId) observeSandbox(latestSandboxId)

      if (runInput.sandboxPreset?.mode === "auto") {
        const currentSandboxId = runInput.sandboxId
        const autoEnvironment = await ensureAutoEnvironmentSandbox({
          authJson: runAuthJson,
          baseBranch: runInput.baseBranch,
          currentSandboxId,
          githubToken: runInput.githubToken,
          githubUserEmail: runInput.githubUserEmail,
          githubUserName: runInput.githubUserName,
          githubUsername: runInput.githubUsername,
          onLog: (log) => {
            contentBuffer.appendToolLog(log)
            logBuffer.emit(log)
          },
          repoUrl: runInput.repoUrl,
          sandboxPreset: runInput.sandboxPreset,
          signal: billingAbort.signal,
          workerSecret: getWorkerSecret(),
        })

        throwIfBillingFailed()
        runAuthJson = autoEnvironment.updatedAuthJson ?? runAuthJson
        runInput = {
          ...runInput,
          authJson: runAuthJson,
          sandboxId: autoEnvironment.sandboxId,
          sandboxPreset: {
            ...runInput.sandboxPreset,
            ...autoEnvironment.preset,
          },
        }
        latestSandboxId = runInput.sandboxId
        if (latestSandboxId) observeSandbox(latestSandboxId)
      }

      const result = await runCodexInSandbox({
        ...runInput,
        authJson: runAuthJson,
        onAuthRefreshRequest: ({ previousAccountId }) =>
          refreshWorkerAuthForRun({
            client,
            previousAccountId,
            profile: loaded.profile,
            runId: payload.runId,
            signal: billingAbort.signal,
            userId: loaded.userId,
          }),
        onContentDelta: (delta) => contentBuffer.append(delta),
        onLog: (log) => {
          contentBuffer.appendToolLog(log)
          logBuffer.emit(log)
        },
        onMcpServerToolsDiscovered: async (servers) => {
          await syncWorkerMcpServerTools(client, payload.runId, servers)
        },
        signal: billingAbort.signal,
      })
      latestSandboxId = result.sandboxId
      observeSandbox(result.sandboxId)
      await Promise.allSettled(sandboxObservations.values())
      throwIfBillingFailed()

      await Promise.all([logBuffer.flush(), contentBuffer.flush()])

      if (isCodexRefreshTokenReusedRunResult(result)) {
        await failCodexAuthReconnectRun({
          client,
          profile: loaded.profile,
          runId: payload.runId,
          sandboxId: result.sandboxId,
          userId: loaded.userId,
        })
        throw new CodexAuthReconnectHandledError()
      }

      await usageMeter.flush("completed")

      if (result.updatedAuthJson !== runAuthJson) {
        await saveWorkerAuthJson(
          loaded.userId,
          loaded.profile,
          result.updatedAuthJson,
          runAuthFingerprint
        )
      }

      const content = workerRunFinalContent(contentBuffer.content, result)
      const completeResponse = await completeWorkerRun(
        client,
        payload.runId,
        content,
        result
      )
      await queueFactoryWakeRuns(completeResponse.factoryWakeRuns)
      await notifyIntegrationRunFinished(
        client,
        payload.runId,
        result.lastMessage
      )
      streamPublisher?.publishDone(
        result.exitCode === 0 ? "succeeded" : "failed"
      )
      await streamPublisher?.flush()

      return {
        canceled: false,
        exitCode: result.exitCode,
        sandboxId: result.sandboxId,
      }
    } catch (error) {
      await Promise.allSettled([logBuffer.flush(), contentBuffer.flush()])
      usageMeter?.stop()
      await usageMeter?.flush("finished-with-error").catch(() => undefined)
      if (latestSandboxId && loadedUserId) {
        await observeSandboxBilling({
          client,
          sandboxId: latestSandboxId,
          source: "observed",
          userId: loadedUserId,
        }).catch(() => undefined)
      }

      if (signal.aborted || isWorkerRunCanceledError(error)) {
        const cancelResponse = await cancelWorkerRun(
          client,
          payload.runId,
          latestSandboxId
        )
        await queueFactoryWakeRuns(cancelResponse?.factoryWakeRuns)
        await notifyIntegrationRunFinished(client, payload.runId)
        streamPublisher?.publishDone("canceled")
        await streamPublisher?.flush()
        return { canceled: true }
      }

      if (error instanceof CodexAuthReconnectHandledError) {
        streamPublisher?.publishError(CODEX_AUTH_RECONNECT_MESSAGE)
        await streamPublisher?.flush()
        throw error
      }

      if (loadedUserId && isCodexRefreshTokenReusedError(error)) {
        await failCodexAuthReconnectRun({
          client,
          profile: loadedProfile,
          runId: payload.runId,
          sandboxId: latestSandboxId,
          userId: loadedUserId,
        })
        streamPublisher?.publishError(CODEX_AUTH_RECONNECT_MESSAGE)
        await streamPublisher?.flush()
        throw new Error(CODEX_AUTH_RECONNECT_MESSAGE)
      }

      const updatedAuthJson = codexAppServerRunUpdatedAuthJson(error)
      if (
        loadedUserId &&
        updatedAuthJson &&
        runAuthJson &&
        updatedAuthJson !== runAuthJson
      ) {
        await saveWorkerAuthJson(
          loadedUserId,
          loadedProfile,
          updatedAuthJson,
          runAuthFingerprint
        ).catch((authError) => {
          console.warn("Unable to save Codex auth after failed run.", authError)
        })
      }

      const failureMessage = errorMessage(error)
      const failResponse = await failWorkerRun(
        client,
        payload.runId,
        failureMessage,
        latestSandboxId
      ).catch((failError) => {
        console.warn("Unable to mark Codex run failed.", failError)
        return undefined
      })
      await queueFactoryWakeRuns(failResponse?.factoryWakeRuns)
      await notifyIntegrationRunFinished(client, payload.runId)
      streamPublisher?.publishError(failureMessage)
      await streamPublisher?.flush()
      throw error
    } finally {
      usageMeter?.stop()
      billingAbort.cleanup()
      // Ephemeral (automation) runs delete their sandbox at run end — after
      // the terminal mutation and final billing observation above, on every
      // exit path. Crash-only leaks are swept by the automations tick.
      if (loadedEphemeral && latestSandboxId && loadedUserId) {
        const sandboxId = latestSandboxId
        await deleteWorkerDaytonaSandbox(client, {
          sandboxId,
          userId: loadedUserId,
        })
          .then(() =>
            client.mutation(api.codexRuns.workerMarkSandboxDeleted, {
              runId: payload.runId,
              sandboxId,
              workerSecret: getWorkerSecret(),
            })
          )
          .catch((error) => {
            console.warn("Unable to delete ephemeral sandbox.", error)
          })
      }
    }
  },
  onCancel: async ({ payload }) => {
    const client = workerConvexClient()
    const response = await cancelWorkerRun(client, payload.runId)
    await queueFactoryWakeRuns(response?.factoryWakeRuns)
    await notifyIntegrationRunFinished(client, payload.runId)
  },
})
