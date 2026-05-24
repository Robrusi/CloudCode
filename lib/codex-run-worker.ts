import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  buildCodexAuthJson,
  saveCodexAuthJsonForWorker,
} from "@/lib/codex-auth"
import type {
  RunCodexInSandboxInput,
  RunCodexInSandboxResult,
  RunCodexLog,
} from "@/lib/daytona-codex-agent"
import { stripInlineToolMarkers } from "@/lib/codex-run-log"
import type { SandboxPresetForRun } from "@/lib/sandbox-presets"
import { decryptSecret } from "@/lib/secret-crypto"

export type WorkerRunPayload = {
  runId: Id<"codexRuns">
}

type WorkerRunRecord = {
  assistantMessageId: Id<"messages">
  baseBranch?: string
  branchName?: string
  codexThreadId?: string
  githubToken?: string
  githubUserEmail?: string
  githubUserName?: string
  githubUsername?: string
  model: string
  previousDiff?: string
  profile?: string
  prompt: string
  reasoningEffort: RunCodexInSandboxInput["reasoningEffort"]
  repoUrl: string
  resumeContext?: string
  sandboxId?: string
  sandboxPresetId?: Id<"sandboxPresets">
  speed: RunCodexInSandboxInput["speed"]
  threadId: Id<"threads">
  userId: Id<"users">
}

type WorkerAuthRecord = Parameters<typeof buildCodexAuthJson>[0]

type WorkerPresetRecord = Omit<SandboxPresetForRun, "secrets"> & {
  secrets: Array<{ name: string; value: string }>
}

type WorkerRunInputResponse =
  | { canceled: true }
  | {
      auth: WorkerAuthRecord
      canceled: false
      run: WorkerRunRecord
      sandboxPreset?: WorkerPresetRecord
    }

export type LoadedWorkerRun = {
  authJson: string
  input: Omit<
    RunCodexInSandboxInput,
    "onContentDelta" | "onLog" | "sandboxPreset" | "signal"
  > & {
    sandboxPreset?: SandboxPresetForRun
  }
  profile?: string
  userId: Id<"users">
}

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL

  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before running Trigger tasks.")
  }

  return url
}

export function getWorkerSecret() {
  const workerSecret = process.env.TRIGGER_WORKER_SECRET

  if (!workerSecret) {
    throw new Error("Set TRIGGER_WORKER_SECRET before running Trigger tasks.")
  }

  return workerSecret
}

export function workerConvexClient() {
  return new ConvexHttpClient(getConvexUrl())
}

function decryptPreset(
  preset: WorkerPresetRecord | undefined
): SandboxPresetForRun | undefined {
  if (!preset) return undefined

  return {
    ...preset,
    secrets: preset.secrets.map((secret) => ({
      name: secret.name,
      value: decryptSecret(secret.value),
    })),
  }
}

export async function startAndLoadWorkerRun(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  triggerRunId: string
): Promise<LoadedWorkerRun | null> {
  const response = (await client.mutation(
    api.codexRuns.workerStartAndGetInput,
    {
      runId,
      triggerRunId,
      workerSecret: getWorkerSecret(),
    }
  )) as WorkerRunInputResponse

  if (response.canceled) return null

  const sandboxPreset = decryptPreset(response.sandboxPreset)
  const authJson = buildCodexAuthJson(response.auth)

  return {
    authJson,
    input: {
      authJson,
      baseBranch: response.run.baseBranch,
      branchName: response.run.branchName,
      codexThreadId: response.run.codexThreadId,
      githubToken: response.run.githubToken
        ? decryptSecret(response.run.githubToken)
        : undefined,
      githubUserEmail: response.run.githubUserEmail,
      githubUserName: response.run.githubUserName,
      githubUsername: response.run.githubUsername,
      model: response.run.model,
      previousDiff: response.run.previousDiff,
      prompt: response.run.prompt,
      reasoningEffort: response.run.reasoningEffort,
      repoUrl: response.run.repoUrl,
      resumeContext: response.run.resumeContext,
      sandboxId: response.run.sandboxId,
      sandboxPreset,
      speed: response.run.speed,
    },
    profile: response.run.profile,
    userId: response.run.userId,
  }
}

export async function appendWorkerRunLogs(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  logs: Array<RunCodexLog & { time: number }>
) {
  return await client.mutation(api.codexRuns.workerAppendLogs, {
    logs,
    runId,
    workerSecret: getWorkerSecret(),
  })
}

export async function updateWorkerRunContent(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  content: string
) {
  return await client.mutation(api.codexRuns.workerUpdateContent, {
    content,
    runId,
    workerSecret: getWorkerSecret(),
  })
}

export async function completeWorkerRun(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  content: string,
  result: RunCodexInSandboxResult
) {
  return await client.mutation(api.codexRuns.workerComplete, {
    branchName: result.branchName,
    codexThreadId: result.codexThreadId,
    content,
    diff: result.diff,
    exitCode: result.exitCode,
    runId,
    sandboxId: result.sandboxId,
    statusText: result.status,
    workerSecret: getWorkerSecret(),
  })
}

export async function failWorkerRun(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  error: string,
  sandboxId?: string
) {
  return await client.mutation(api.codexRuns.workerFail, {
    error,
    runId,
    sandboxId,
    workerSecret: getWorkerSecret(),
  })
}

export async function cancelWorkerRun(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  sandboxId?: string
) {
  return await client.mutation(api.codexRuns.workerCancel, {
    runId,
    sandboxId,
    workerSecret: getWorkerSecret(),
  })
}

export async function saveWorkerAuthJson(
  userId: Id<"users">,
  profile: string | undefined,
  authJson: string
) {
  return await saveCodexAuthJsonForWorker({
    authJson,
    profile,
    userId,
    workerSecret: getWorkerSecret(),
  })
}

export function workerRunFinalContent(
  streamedContent: string,
  result: RunCodexInSandboxResult
) {
  const streamed = streamedContent.trim()
  const lastMessage = result.lastMessage.trim()

  if (streamed && stripInlineToolMarkers(streamed)) {
    return streamed
  }

  if (streamed && lastMessage) {
    return `${streamed}\n\n${lastMessage}`
  }

  return (
    streamed ||
    lastMessage ||
    result.stdout.trim() ||
    result.stderr.trim() ||
    "(no output)"
  )
}
