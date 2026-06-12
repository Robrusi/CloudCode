import type { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getConvexAuthToken } from "@/lib/codex/auth"
import type { CodexRunLog as RunCodexLog } from "@/lib/codex/run-log"
import { createConvexHttpClient } from "@/lib/convex/http"

export type AutoEnvironmentConvexClient = ConvexHttpClient

const BUILD_LOG_BATCH_SIZE = 20
const BUILD_LOG_FLUSH_DELAY_MS = 500
const BUILD_LOG_FINAL_FLUSH_TIMEOUT_MS = 2_000

export type AutoEnvironmentBuildRecord = {
  buildId: Id<"sandboxPresetBuilds">
  buildNumber: number
  environmentId: Id<"sandboxPresetEnvironments">
  environmentSlug: string
}

type AutoEnvironmentStoreInput = {
  baseBranch?: string
  repoUrl: string
  sandboxPreset: {
    id: Id<"sandboxPresets">
  }
  workerSecret?: string
}

type BuildLogEmitterInput = {
  onLog?: (log: RunCodexLog) => void | Promise<void>
  workerSecret?: string
}

type StoredBuildLog = RunCodexLog & { time: number }

export async function getAutoEnvironmentConvexClient(workerSecret?: string) {
  const client = createConvexHttpClient()
  if (!workerSecret) {
    client.setAuth(await getConvexAuthToken())
  }
  return client
}

export async function getAutoEnvironmentForRun(
  client: ConvexHttpClient,
  input: AutoEnvironmentStoreInput
) {
  if (input.workerSecret) {
    return (await client.query(
      api.sandboxPresets.getAutoEnvironmentForRunForWorker,
      {
        presetId: input.sandboxPreset.id,
        repoUrl: input.repoUrl,
        workerSecret: input.workerSecret,
      }
    )) as {
      activeSandboxId?: string
      cloudcodeYaml?: string
      status: string
    } | null
  }

  return (await client.query(api.sandboxPresets.getAutoEnvironmentForRun, {
    presetId: input.sandboxPreset.id,
    repoUrl: input.repoUrl,
  })) as {
    activeSandboxId?: string
    cloudcodeYaml?: string
    status: string
  } | null
}

export async function beginAutoEnvironmentBuild(
  client: ConvexHttpClient,
  input: AutoEnvironmentStoreInput
) {
  if (input.workerSecret) {
    return (await client.mutation(
      api.sandboxPresets.beginAutoEnvironmentBuildForWorker,
      {
        baseBranch: input.baseBranch,
        presetId: input.sandboxPreset.id,
        repoUrl: input.repoUrl,
        workerSecret: input.workerSecret,
      }
    )) as AutoEnvironmentBuildRecord
  }

  return (await client.mutation(api.sandboxPresets.beginAutoEnvironmentBuild, {
    baseBranch: input.baseBranch,
    presetId: input.sandboxPreset.id,
    repoUrl: input.repoUrl,
  })) as AutoEnvironmentBuildRecord
}

async function appendAutoEnvironmentBuildLogs(
  client: ConvexHttpClient,
  buildId: Id<"sandboxPresetBuilds">,
  logs: StoredBuildLog[],
  workerSecret?: string
) {
  if (workerSecret) {
    return await client.mutation(
      api.sandboxPresets.appendAutoEnvironmentBuildLogsForWorker,
      {
        buildId,
        logs,
        workerSecret,
      }
    )
  }

  return await client.mutation(
    api.sandboxPresets.appendAutoEnvironmentBuildLogs,
    {
      buildId,
      logs,
    }
  )
}

export async function completeAutoEnvironmentBuild(
  client: ConvexHttpClient,
  args: {
    buildId: Id<"sandboxPresetBuilds">
    cloudcodeYaml: string
    configHash: string
    sandboxId?: string
  },
  workerSecret?: string
) {
  if (workerSecret) {
    return await client.mutation(
      api.sandboxPresets.completeAutoEnvironmentBuildForWorker,
      {
        ...args,
        workerSecret,
      }
    )
  }

  return await client.mutation(
    api.sandboxPresets.completeAutoEnvironmentBuild,
    args
  )
}

export async function failAutoEnvironmentBuild(
  client: ConvexHttpClient,
  args: {
    buildId: Id<"sandboxPresetBuilds">
    error: string
  },
  workerSecret?: string
) {
  if (workerSecret) {
    return await client.mutation(
      api.sandboxPresets.failAutoEnvironmentBuildForWorker,
      {
        ...args,
        workerSecret,
      }
    )
  }

  return await client.mutation(
    api.sandboxPresets.failAutoEnvironmentBuild,
    args
  )
}

export function createBuildLogEmitter(
  client: ConvexHttpClient,
  buildId: Id<"sandboxPresetBuilds">,
  input: BuildLogEmitterInput
) {
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let flushPromise: Promise<void> | undefined
  const pending: StoredBuildLog[] = []

  const clearFlushTimer = () => {
    if (!flushTimer) return
    clearTimeout(flushTimer)
    flushTimer = undefined
  }

  const flush = () => {
    if (flushPromise) return flushPromise
    clearFlushTimer()
    const logs = pending.splice(0, BUILD_LOG_BATCH_SIZE)
    if (logs.length === 0) return Promise.resolve()

    flushPromise = appendAutoEnvironmentBuildLogs(
      client,
      buildId,
      logs,
      input.workerSecret
    )
      .catch(() => undefined)
      .then(() => undefined)
      .finally(() => {
        flushPromise = undefined
        if (pending.length > 0) void flush()
      })

    return flushPromise
  }

  const scheduleFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      void flush()
    }, BUILD_LOG_FLUSH_DELAY_MS)
  }

  const waitForFinalFlush = async () => {
    clearFlushTimer()
    const deadline = Date.now() + BUILD_LOG_FINAL_FLUSH_TIMEOUT_MS

    const flushUntilDone = async (): Promise<void> => {
      if ((pending.length === 0 && !flushPromise) || Date.now() >= deadline) {
        return
      }
      if (pending.length > 0) void flush()
      await (flushPromise ?? Promise.resolve())
      return flushUntilDone()
    }

    await flushUntilDone()
  }

  return {
    emit(log: RunCodexLog) {
      try {
        void input.onLog?.(log)
      } catch {
        // The live response may already be closed; persisted logs are best effort.
      }

      pending.push({ ...log, time: Date.now() })
      if (pending.length >= BUILD_LOG_BATCH_SIZE) void flush()
      else scheduleFlush()

      return Promise.resolve()
    },
    flush: waitForFinalFlush,
  }
}
