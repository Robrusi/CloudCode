import { createHash } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import {
  CodexAppServerError,
  createCodexAppServerTurnReducer,
} from "@/lib/codex/app-server"
import {
  appServerThreadParams,
  appServerTurnParams,
} from "@/lib/codex/app-server-run-params"
import { codexAppServerStderrLogForLine } from "@/lib/codex/app-server-stderr"
import { isWorkerRunCanceledError } from "@/lib/codex/run-cancel-error"
import { isCodexRefreshTokenReusedRunResult } from "@/lib/codex/auth-errors"
import {
  codexAppServerNotificationMatchesActiveRoute,
  codexAppServerNotificationRoute,
  type CodexAppServerDaemonEvent,
} from "@/lib/codex/app-server-daemon"
import {
  ensureCodexAppServerDaemon,
  requestCodexAppServerDaemon,
} from "@/lib/codex/app-server-daemon-runtime"
import type { CodexRunLog as RunCodexLog } from "@/lib/codex/run-log"
import type { CodexSpeed, ReasoningEffort } from "@/lib/codex/run-options"
import { redactCodexAuthPayloads } from "@/lib/codex/auth-redaction"
import { compactLine } from "@/lib/shared/compact-line"
import {
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"
import type { SandboxGitHubAuth } from "@/lib/sandbox/github-auth"
import type { McpServerInput } from "@/lib/daytona/codex-runtime"
import type { SandboxPresetEnvVar } from "@/lib/sandbox/env"
import {
  discoveredMcpServersFromStatus,
  type McpDiscoveredServer,
} from "@/lib/mcp/discovery"

type RunCodexViaAppServerInput = {
  authJson: string
  mcpServers?: McpServerInput[]
  onAuthRefreshRequest?: (request: {
    previousAccountId?: string
    requestId: string
  }) => Promise<{
    authJson: string
    result: Record<string, unknown>
  }>
  onContentDelta?: (delta: string) => void | Promise<void>
  onLog?: (log: RunCodexLog) => void | Promise<void>
  onMcpServerToolsDiscovered?: (
    servers: McpDiscoveredServer[]
  ) => void | Promise<void>
  sandboxPreset?: { secrets: SandboxPresetEnvVar[] }
  signal?: AbortSignal
}

export type CodexAppServerRunResult = {
  codexThreadId: string
  exitCode: number
  lastMessage: string
  stderr: string
  stdout: string
  updatedAuthJson: string
}

export class CodexAppServerRunError extends Error {
  updatedAuthJson?: string

  constructor(message: string, options: { updatedAuthJson?: string } = {}) {
    super(message)
    this.name = "CodexAppServerRunError"
    this.updatedAuthJson = options.updatedAuthJson
  }
}

export function codexAppServerRunUpdatedAuthJson(error: unknown) {
  return error instanceof CodexAppServerRunError
    ? error.updatedAuthJson
    : undefined
}

export function redactCodexAppServerAuthPayloads(value: string) {
  return redactCodexAuthPayloads(value)
}

function validateDaemonResponsePath(
  paths: DaytonaSandboxPaths,
  responsePath: string
) {
  const root = `${paths.runtimeHome.replace(/\/+$/, "")}/codex-app-server/`
  if (!responsePath.startsWith(root) || responsePath.includes("\0")) {
    throw new Error("Codex app-server daemon response path is invalid.")
  }
  return responsePath
}

export async function runCodexViaAppServer({
  codexThreadIdToResume,
  gitAuth,
  input,
  model,
  paths,
  prompt,
  reasoningEffort,
  sandbox,
  speed,
}: {
  codexThreadIdToResume?: string
  gitAuth?: SandboxGitHubAuth | null
  input: RunCodexViaAppServerInput
  model?: string
  paths: DaytonaSandboxPaths
  prompt: string
  reasoningEffort?: ReasoningEffort
  sandbox: Sandbox
  speed: CodexSpeed
}): Promise<CodexAppServerRunResult> {
  let activeThreadId = codexThreadIdToResume
  let activeTurnId: string | undefined
  let daemonResult:
    | Extract<CodexAppServerDaemonEvent, { type: "result" }>
    | undefined
  let daemonError = ""
  let updatedAuthJson: string | undefined
  let stdout = ""
  let stderr = ""
  let resumeLogged = false
  let bundledBubblewrapWarningLogged = false
  const discoveryTasks: Promise<void>[] = []
  const authRefreshTasks: Promise<void>[] = []

  try {
    const daemon = await ensureCodexAppServerDaemon({
      gitAuth,
      mcpServers: input.mcpServers,
      onLog: (log) => emitLog(input, log),
      paths,
      presetSecrets: input.sandboxPreset?.secrets,
      sandbox,
      signal: input.signal,
    })
    const reducer = createCodexAppServerTurnReducer({
      onContentDelta: input.onContentDelta,
      onLog: input.onLog,
    })
    const threadParams = appServerThreadParams({
      model,
      paths,
      reasoningEffort,
      speed,
    })
    const turnParams = appServerTurnParams({
      model,
      paths,
      prompt,
      reasoningEffort,
      speed,
      threadId: activeThreadId ?? "__cloudcode_pending_thread__",
    })

    const emitDaemonStderr = (line: string) => {
      const log = codexAppServerStderrLogForLine(line, {
        bundledBubblewrapWarningAlreadyLogged: bundledBubblewrapWarningLogged,
      })
      if (!log) return
      if (log.message === "Codex using bundled bubblewrap sandbox helper") {
        bundledBubblewrapWarningLogged = true
      }
      void input.onLog?.(log)
    }

    const interruptDaemonRun = () => {
      void requestCodexAppServerDaemon({
        daemonPaths: daemon.paths,
        gitAuth,
        label: "interrupt",
        paths,
        payload: { type: "interrupt" },
        sandbox,
        timeoutMs: 10_000,
      }).catch(() => undefined)
    }
    input.signal?.addEventListener("abort", interruptDaemonRun, { once: true })
    if (input.signal?.aborted) interruptDaemonRun()

    const daemonResponse = await requestCodexAppServerDaemon({
      daemonPaths: daemon.paths,
      gitAuth,
      label: "run",
      onEvent: (event) => {
        stdout += `${redactCodexAppServerAuthPayloads(JSON.stringify(event))}\n`
        switch (event.type) {
          case "thread": {
            activeThreadId = event.threadId
            if (codexThreadIdToResume && !resumeLogged) {
              resumeLogged = true
              void emitLog(input, {
                detail: activeThreadId,
                kind: "setup",
                message: "Resumed Codex thread",
              })
            }
            return
          }
          case "notification": {
            const { notification } = event
            if (
              !codexAppServerNotificationMatchesActiveRoute({
                activeThreadId,
                activeTurnId,
                notification,
              })
            ) {
              return
            }

            const route = codexAppServerNotificationRoute(notification)
            if (
              notification.method === "turn/started" &&
              route.turnId &&
              (!activeThreadId ||
                !route.threadId ||
                route.threadId === activeThreadId)
            ) {
              activeTurnId ??= route.turnId
            }

            reducer.handleNotification(notification)
            return
          }
          case "stderr":
            stderr += `${event.line}\n`
            emitDaemonStderr(event.line)
            return
          case "setup":
            if (
              event.message === "Codex using bundled bubblewrap sandbox helper"
            ) {
              if (bundledBubblewrapWarningLogged) return
              bundledBubblewrapWarningLogged = true
            }
            void emitLog(input, { kind: "setup", message: event.message })
            return
          case "mcpStatus": {
            const discovered = discoveredMcpServersFromStatus(event.status)
            if (!discovered.length || !input.onMcpServerToolsDiscovered) {
              return
            }
            discoveryTasks.push(
              Promise.resolve(input.onMcpServerToolsDiscovered(discovered))
                .then(() => undefined)
                .catch((error) => {
                  void emitLog(input, {
                    detail:
                      error instanceof Error ? error.message : String(error),
                    kind: "stderr",
                    message: "Unable to save discovered MCP tools",
                  })
                })
            )
            return
          }
          case "error":
            daemonError = event.message
            return
          case "authRefreshRequest": {
            const task = (async () => {
              const responsePath = validateDaemonResponsePath(
                paths,
                event.responsePath
              )
              try {
                if (!input.onAuthRefreshRequest) {
                  throw new Error(
                    "Cloudcode auth refresh coordinator is unavailable."
                  )
                }
                const refreshed = await input.onAuthRefreshRequest({
                  ...(event.previousAccountId
                    ? { previousAccountId: event.previousAccountId }
                    : {}),
                  requestId: event.requestId,
                })
                await writeDaytonaTextFile(
                  sandbox,
                  responsePath,
                  JSON.stringify(refreshed)
                )
              } catch (error) {
                await writeDaytonaTextFile(
                  sandbox,
                  responsePath,
                  JSON.stringify({
                    error:
                      error instanceof Error
                        ? error.message
                        : "Cloudcode auth refresh failed.",
                  })
                ).catch(() => undefined)
              }
            })()
            authRefreshTasks.push(task)
            return
          }
          case "result":
            daemonResult = event
            activeThreadId = event.threadId
            return
        }
      },
      paths,
      payload: {
        authHash: sha256(input.authJson),
        authJson: input.authJson,
        authRefreshResponseDir: `${paths.runtimeHome.replace(
          /\/+$/,
          ""
        )}/codex-app-server`,
        codexThreadIdToResume,
        threadParams,
        turnParams,
        type: "run",
      },
      sandbox,
      signal: input.signal,
    }).finally(() => {
      input.signal?.removeEventListener("abort", interruptDaemonRun)
    })
    const { result } = daemonResponse
    await Promise.all(authRefreshTasks)
    updatedAuthJson = daemonResponse.updatedAuthJson

    if (result.stderr) {
      stderr += result.stderr
    }
    if (result.exitCode !== 0 && !daemonError) {
      daemonError =
        compactLine(
          redactCodexAppServerAuthPayloads(result.stderr || result.stdout)
        ) || "Codex app-server daemon client failed."
    }
    if (daemonError) {
      throw new CodexAppServerRunError(daemonError, {
        updatedAuthJson,
      })
    }
    if (!daemonResult) {
      throw new Error("Codex app-server daemon did not return a turn result.")
    }
    if (!updatedAuthJson) {
      throw new Error("Codex app-server daemon did not return updated auth.")
    }

    if (!activeThreadId) {
      throw new Error("Codex app-server did not return a thread id.")
    }
    await Promise.all(discoveryTasks)

    const summary = reducer.summary()
    const status =
      summary.status === "inProgress" ? daemonResult.status : summary.status
    const exitCode = status === "completed" ? 0 : 1
    const lastMessage =
      summary.finalAssistantText || daemonResult.finalAssistantText || ""
    const turnError =
      status === "completed"
        ? ""
        : summary.turnError || daemonResult.turnError || stderr
    if (
      isCodexRefreshTokenReusedRunResult({
        exitCode,
        lastMessage,
        stderr: turnError,
        stdout,
      })
    ) {
      throw new CodexAppServerRunError(
        turnError || "Codex ChatGPT auth refresh failed.",
        { updatedAuthJson }
      )
    }

    return {
      codexThreadId: activeThreadId,
      exitCode,
      lastMessage,
      stderr: turnError,
      stdout,
      updatedAuthJson,
    }
  } catch (error) {
    // Cancellation must reach the worker unchanged: wrapping would both lose
    // the WorkerRunCanceledError type and bloat the error with the full
    // daemon event stream captured in stdout.
    if (isWorkerRunCanceledError(error) || input.signal?.aborted) throw error
    const errorUpdatedAuthJson =
      error instanceof CodexAppServerRunError
        ? error.updatedAuthJson
        : updatedAuthJson
    const message = redactCodexAppServerAuthPayloads(
      error instanceof CodexAppServerError && error.code !== undefined
        ? `${error.message} (${error.code})`
        : error instanceof Error
          ? error.message
          : "Codex app-server run failed."
    )
    const safeStdout = redactCodexAppServerAuthPayloads(stdout.trim())
    const safeStderr = redactCodexAppServerAuthPayloads(stderr.trim())

    if (safeStdout || safeStderr) {
      throw new CodexAppServerRunError(
        [message, safeStdout, safeStderr].filter(Boolean).join("\n\n"),
        { updatedAuthJson: errorUpdatedAuthJson }
      )
    }
    if (errorUpdatedAuthJson) {
      throw new CodexAppServerRunError(message, {
        updatedAuthJson: errorUpdatedAuthJson,
      })
    }
    throw new CodexAppServerRunError(message)
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

async function emitLog(input: RunCodexViaAppServerInput, log: RunCodexLog) {
  await input.onLog?.(log)
}
