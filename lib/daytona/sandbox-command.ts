import { randomUUID } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import { envNumber } from "@/lib/daytona/env"

const DEFAULT_COMMAND_STATUS_POLL_MS = 2_000
const DEFAULT_COMMAND_STATUS_MAX_POLL_MS = 5_000

export type DaytonaCommandResult = {
  exitCode: number
  stderr: string
  stdout: string
}

export type DaytonaRunCommandOptions = {
  cwd?: string
  env?: Record<string, string | undefined>
  onStderr?: (chunk: string) => void
  onStdout?: (chunk: string) => void
  signal?: AbortSignal
  timeoutMs?: number
}

function timeoutSeconds(timeoutMs?: number) {
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) {
    return undefined
  }
  return Math.max(1, Math.ceil(timeoutMs / 1000))
}

function commandStatusPollMs() {
  return Math.max(
    500,
    Math.round(
      envNumber(
        "DAYTONA_COMMAND_STATUS_POLL_MS",
        DEFAULT_COMMAND_STATUS_POLL_MS
      )
    )
  )
}

function commandStatusMaxPollMs() {
  return Math.max(
    commandStatusPollMs(),
    Math.round(
      envNumber(
        "DAYTONA_COMMAND_STATUS_MAX_POLL_MS",
        DEFAULT_COMMAND_STATUS_MAX_POLL_MS
      )
    )
  )
}

function validEnvName(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

// Tool installers often call tar as root; user-namespaced sandbox storage can
// reject archive uid/gid ownership, so extraction must ignore stored owners.
const DAYTONA_TAR_WRAPPER = [
  "#!/usr/bin/env bash",
  "set -e",
  'real_tar="/usr/bin/tar"',
  '[ -x "$real_tar" ] || real_tar="/bin/tar"',
  'if [ ! -x "$real_tar" ]; then',
  '  echo "Unable to find system tar." >&2',
  "  exit 127",
  "fi",
  "extract=0",
  "index=0",
  'for arg in "$@"; do',
  "  index=$((index + 1))",
  '  case "$arg" in',
  "    --extract|-x|-*x*) extract=1 ;;",
  "    --) break ;;",
  "    --*) ;;",
  "    -*) ;;",
  '    *) if [ "$index" = "1" ]; then case "$arg" in *x*) extract=1 ;; esac; fi ;;',
  "  esac",
  "done",
  'if [ "$extract" = "1" ]; then',
  '  exec "$real_tar" --no-same-owner --no-same-permissions "$@"',
  "fi",
  'exec "$real_tar" "$@"',
  "",
].join("\n")

export function replayMissingDaytonaCommandOutput({
  finalOutput,
  onMissingOutput,
  streamedOutput,
}: {
  finalOutput: string
  onMissingOutput?: (chunk: string) => void
  streamedOutput: string
}) {
  if (!finalOutput || finalOutput === streamedOutput) return streamedOutput

  if (finalOutput.startsWith(streamedOutput)) {
    const missingOutput = finalOutput.slice(streamedOutput.length)
    if (missingOutput) onMissingOutput?.(missingOutput)
  }

  return finalOutput
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return (await Promise.race([promise, wait(timeoutMs)])) as T | void
}

export async function installDaytonaTarWrapper(
  sandbox: Sandbox,
  paths: { home: string }
) {
  const binDir = `${paths.home}/.local/bin`
  const wrapperPath = `${binDir}/tar`

  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -eo pipefail",
      `mkdir -p ${shellQuote(binDir)}`,
      `cat > ${shellQuote(wrapperPath)} <<'EOF'`,
      DAYTONA_TAR_WRAPPER.trimEnd(),
      "EOF",
      `chmod +x ${shellQuote(wrapperPath)}`,
      `ln -sf ${shellQuote(wrapperPath)} /usr/local/bin/tar 2>/dev/null || true`,
      `${shellQuote(wrapperPath)} --version >/dev/null`,
    ].join("\n"),
    { cwd: paths.home, timeoutMs: 10_000 }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Unable to install sandbox tar wrapper."
    )
  }
}

function buildSessionCommand(
  command: string,
  options: DaytonaRunCommandOptions
) {
  const envEntries = Object.entries(options.env ?? {}).filter(
    (entry): entry is [string, string] =>
      validEnvName(entry[0]) && typeof entry[1] === "string"
  )
  const env = envEntries
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(" ")
  const envExports = envEntries
    .map(([name, value]) => `export ${name}=${shellQuote(value)}`)
    .join("\n")
  const script = [
    envExports,
    options.cwd ? `cd ${shellQuote(options.cwd)}` : "",
    command,
  ]
    .filter(Boolean)
    .join("\n")

  return `${env ? `env ${env} ` : ""}bash -lc ${shellQuote(script)}`
}

async function waitForCommandExit(
  sandbox: Sandbox,
  sessionId: string,
  commandId: string,
  signal?: AbortSignal,
  timeoutMs?: number
) {
  const deadline =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Date.now() + timeoutMs
      : undefined
  const initialPollMs = commandStatusPollMs()
  const maxPollMs = commandStatusMaxPollMs()
  let pollMs = initialPollMs
  let command = await sandbox.process.getSessionCommand(sessionId, commandId)

  while (
    command.exitCode === undefined &&
    (deadline === undefined || Date.now() < deadline)
  ) {
    if (signal?.aborted) {
      await sandbox.process.deleteSession(sessionId).catch(() => undefined)
      throw new Error("Run was canceled.")
    }
    await waitForPoll(pollMs, signal)
    if (signal?.aborted) {
      await sandbox.process.deleteSession(sessionId).catch(() => undefined)
      throw new Error("Run was canceled.")
    }
    pollMs = Math.min(maxPollMs, Math.round(pollMs * 1.5))
    command = await sandbox.process.getSessionCommand(sessionId, commandId)
  }

  return command.exitCode ?? 124
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function waitForPoll(ms: number, signal?: AbortSignal) {
  if (!signal) return wait(ms)
  if (signal.aborted) return Promise.resolve()

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(done, ms)

    function done() {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", done)
      resolve()
    }

    signal.addEventListener("abort", done, { once: true })
  })
}

export async function runDaytonaCommand(
  sandbox: Sandbox,
  command: string,
  options: DaytonaRunCommandOptions = {}
): Promise<DaytonaCommandResult> {
  const sessionId = `cloudcode-${Date.now()}-${randomUUID().slice(0, 8)}`
  const timeout = timeoutSeconds(options.timeoutMs)
  const wrappedCommand = buildSessionCommand(command, options)

  await sandbox.process.createSession(sessionId)

  try {
    if (options.signal?.aborted) {
      throw new Error("Run was canceled.")
    }

    if (options.onStdout || options.onStderr) {
      const response = await sandbox.process.executeSessionCommand(
        sessionId,
        {
          command: wrappedCommand,
          runAsync: true,
          suppressInputEcho: true,
        },
        timeout
      )
      const commandId = response.cmdId
      let stdout = ""
      let stderr = ""

      const logsPromise =
        options.onStdout || options.onStderr
          ? sandbox.process
              .getSessionCommandLogs(
                sessionId,
                commandId,
                (chunk) => {
                  stdout += chunk
                  options.onStdout?.(chunk)
                },
                (chunk) => {
                  stderr += chunk
                  options.onStderr?.(chunk)
                }
              )
              .catch(() => undefined)
          : Promise.resolve()

      const exitCode = await waitForCommandExit(
        sandbox,
        sessionId,
        commandId,
        options.signal,
        options.timeoutMs
      )

      await Promise.race([logsPromise, wait(1_000)])
      const logs = await withTimeout(
        sandbox.process.getSessionCommandLogs(sessionId, commandId),
        5_000
      ).catch(() => undefined)

      if (logs) {
        stdout = replayMissingDaytonaCommandOutput({
          finalOutput: logs.stdout ?? logs.output ?? "",
          onMissingOutput: options.onStdout,
          streamedOutput: stdout,
        })
        stderr = replayMissingDaytonaCommandOutput({
          finalOutput: logs.stderr ?? "",
          onMissingOutput: options.onStderr,
          streamedOutput: stderr,
        })
      }

      return {
        exitCode,
        stderr,
        stdout,
      }
    }

    if (options.signal?.aborted) {
      throw new Error("Run was canceled.")
    }

    const response = await sandbox.process.executeSessionCommand(
      sessionId,
      {
        command: wrappedCommand,
        suppressInputEcho: true,
      },
      timeout
    )
    return {
      exitCode: response.exitCode ?? 0,
      stderr: response.stderr ?? "",
      stdout: response.stdout ?? response.output ?? "",
    }
  } finally {
    await sandbox.process.deleteSession(sessionId).catch(() => undefined)
  }
}
