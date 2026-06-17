import { schedules, task, timeout } from "@trigger.dev/sdk"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { ensureAutoEnvironmentSandbox } from "@/lib/sandbox/auto-environment"
import { runCodexInSandbox } from "@/lib/daytona/codex-agent"
import { codexAppServerRunUpdatedAuthJson } from "@/lib/daytona/codex-app-server-run"
import {
  CODEX_AUTH_RECONNECT_MESSAGE,
  isCodexRefreshTokenReusedError,
} from "@/lib/codex/auth-errors"
import {
  cancelWorkerRun,
  completeWorkerRun,
  failWorkerRun,
  getWorkerSecret,
  invalidateWorkerAuthProfile,
  isWorkerRunCanceledError,
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
  createBillingAbortController,
  createTriggerUsageMeter,
  observeActiveBillingSandboxSegment,
  observeSandboxBilling,
  pauseSandboxForBilling,
  type ActiveBillingSandboxSegment,
} from "@/trigger/cloudcode-run-billing"

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Codex run failed."
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
    const logBuffer = createLogBuffer(client, payload.runId, (sandboxId) => {
      latestSandboxId = sandboxId
      observeSandbox(sandboxId)
    })
    const contentBuffer = createContentBuffer(client, payload.runId)

    try {
      const loaded = await startAndLoadWorkerRun(
        client,
        payload.runId,
        ctx.run.id
      )
      if (!loaded) return { canceled: true }

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
      await usageMeter.flush("completed")

      await Promise.all([logBuffer.flush(), contentBuffer.flush()])

      if (result.updatedAuthJson !== runAuthJson) {
        await saveWorkerAuthJson(
          loaded.userId,
          loaded.profile,
          result.updatedAuthJson,
          runAuthFingerprint
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
        await cancelWorkerRun(client, payload.runId, latestSandboxId)
        return { canceled: true }
      }

      if (
        loadedUserId &&
        loadedProfile &&
        isCodexRefreshTokenReusedError(error)
      ) {
        await invalidateWorkerAuthProfile(
          loadedUserId,
          loadedProfile,
          "refresh_token_reused"
        ).catch((authError) => {
          console.warn("Unable to invalidate Codex auth profile.", authError)
        })
        await failWorkerRun(
          client,
          payload.runId,
          CODEX_AUTH_RECONNECT_MESSAGE,
          latestSandboxId
        ).catch((failError) => {
          console.warn("Unable to mark Codex run failed.", failError)
        })
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

      await failWorkerRun(
        client,
        payload.runId,
        errorMessage(error),
        latestSandboxId
      ).catch((failError) => {
        console.warn("Unable to mark Codex run failed.", failError)
      })
      throw error
    } finally {
      usageMeter?.stop()
      billingAbort.cleanup()
    }
  },
  onCancel: async ({ payload }) => {
    await cancelWorkerRun(workerConvexClient(), payload.runId)
  },
})
