import type { Sandbox } from "@daytona/sdk"

import { installDaytonaDesktopTools } from "@/lib/daytona/desktop"
import {
  resolveDaytonaPaths,
  runDaytonaCommand,
  shellQuote,
} from "@/lib/daytona/sandbox"
import { uiTestsServerEnv } from "@/lib/daytona/ui-tests-mcp-script"

const LIST_TIMEOUT_MS = 30_000
const RUN_TIMEOUT_MS = 15 * 60 * 1000
const DEFAULT_RUN_TIMEOUT_MS = 90_000
const MAX_RUN_TIMEOUT_MS = 10 * 60 * 1000

/** A deterministic UI test file discovered under `.cloudcode/tests`. */
export type DaytonaUiTestFile = {
  path: string
  sizeBytes?: number
  updatedAt?: number
}

export type DaytonaUiTestRecording = {
  fileName?: string
  id: string
  sandboxId?: string
  status?: string
}

/** A single reporter/overlay event emitted during a run. */
export type DaytonaUiTestEvent = {
  atMs?: number
  category?: string
  durationMs?: number
  error?: string
  file?: string
  line?: number
  seq?: number
  status?: string
  test?: string
  title?: string
  total?: number
  type?: string
  workers?: number
}

/** Lightweight run summary used for the tests list. */
export type DaytonaUiTestRunSummary = {
  baseUrl?: string
  createdAt?: number | null
  desktop?: {
    display?: string
    height?: number
    width?: number
  }
  durationMs?: number
  error?: string
  failed?: number
  passed?: number
  recording?: DaytonaUiTestRecording
  runId: string
  skipped?: number
  status?: string
  testPath?: string | null
  updatedAt?: number | null
  viewport?: {
    height?: number
    width?: number
  }
}

/** A full run result, including the event timeline used to render the report. */
export type DaytonaUiTestRun = DaytonaUiTestRunSummary & {
  events?: DaytonaUiTestEvent[]
  exitCode?: number
  stderr?: string
  stdout?: string
  stopRecordingError?: string
}

export type DaytonaUiTestRunInput = {
  baseUrl?: string
  grep?: string
  testPath?: string
  timeoutMs?: number
}

function cliPath(home: string) {
  return `${home}/.local/bin/cloudcode-ui-tests`
}

async function runUiTestsCli(
  sandbox: Sandbox,
  args: string[],
  options: { signal?: AbortSignal; timeoutMs: number }
): Promise<unknown> {
  const paths = await resolveDaytonaPaths(sandbox)
  await installDaytonaDesktopTools(sandbox, paths, options.signal)
  const toolboxPreview = await sandbox.getPreviewLink(1)
  const command = [cliPath(paths.home), ...args].map(shellQuote).join(" ")
  const result = await runDaytonaCommand(sandbox, command, {
    cwd: paths.repoPath,
    env: uiTestsServerEnv({
      paths,
      sandboxId: sandbox.id,
      toolboxAuthKey: toolboxPreview.token,
      toolboxBaseUrl: sandbox.toolboxProxyUrl,
    }),
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  })

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Cloudcode UI tests command failed."
    )
  }

  return parseCliJson(result.stdout)
}

function parseCliJson(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error("Cloudcode UI tests returned no output.")
  try {
    return JSON.parse(trimmed)
  } catch {
    // The CLI prints a single pretty-printed JSON document, but tolerate any
    // leading shell noise by parsing from the first opening brace/bracket.
    const start = trimmed.search(/[{[]/)
    if (start >= 0) {
      try {
        return JSON.parse(trimmed.slice(start))
      } catch {
        // fall through to the shared error below
      }
    }
    throw new Error("Cloudcode UI tests returned unparsable output.")
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * The in-sandbox runner can only stamp a recording's `sandboxId` from its own
 * environment. Anchor it to the authorized sandbox so the browser can fetch the
 * recording through the recordings route regardless of how the run was started.
 */
function withRecordingSandbox<T extends { recording?: DaytonaUiTestRecording }>(
  result: T,
  sandboxId: string
): T {
  if (!result.recording?.id) return result
  return {
    ...result,
    recording: { ...result.recording, sandboxId },
  }
}

export async function listDaytonaUiTests(
  sandbox: Sandbox,
  options: { signal?: AbortSignal } = {}
): Promise<{ testDir: string | null; tests: DaytonaUiTestFile[] }> {
  const parsed = asRecord(
    await runUiTestsCli(sandbox, ["list"], {
      signal: options.signal,
      timeoutMs: LIST_TIMEOUT_MS,
    })
  )
  return {
    testDir: typeof parsed.testDir === "string" ? parsed.testDir : null,
    tests: asArray(parsed.tests) as DaytonaUiTestFile[],
  }
}

export async function listDaytonaUiTestRuns(
  sandbox: Sandbox,
  options: { signal?: AbortSignal } = {}
): Promise<{ runs: DaytonaUiTestRunSummary[] }> {
  const parsed = asRecord(
    await runUiTestsCli(sandbox, ["runs"], {
      signal: options.signal,
      timeoutMs: LIST_TIMEOUT_MS,
    })
  )
  const runs = (asArray(parsed.runs) as DaytonaUiTestRunSummary[]).map((run) =>
    withRecordingSandbox(run, sandbox.id)
  )
  return { runs }
}

export async function getDaytonaUiTestRun(
  sandbox: Sandbox,
  runId: string,
  options: { signal?: AbortSignal } = {}
): Promise<DaytonaUiTestRun> {
  const parsed = (await runUiTestsCli(sandbox, ["result", "--run-id", runId], {
    signal: options.signal,
    timeoutMs: LIST_TIMEOUT_MS,
  })) as DaytonaUiTestRun
  return withRecordingSandbox(parsed, sandbox.id)
}

function normalizeRunTimeout(timeoutMs?: number) {
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return DEFAULT_RUN_TIMEOUT_MS
  }
  return Math.min(Math.round(timeoutMs), MAX_RUN_TIMEOUT_MS)
}

export async function runDaytonaUiTest(
  sandbox: Sandbox,
  input: DaytonaUiTestRunInput,
  options: { signal?: AbortSignal } = {}
): Promise<DaytonaUiTestRun> {
  const args = ["run"]
  if (input.testPath?.trim()) args.push(input.testPath.trim())
  if (input.baseUrl?.trim()) args.push("--base-url", input.baseUrl.trim())
  if (input.grep?.trim()) args.push("--grep", input.grep.trim())
  args.push("--timeout-ms", String(normalizeRunTimeout(input.timeoutMs)))

  const parsed = (await runUiTestsCli(sandbox, args, {
    signal: options.signal,
    timeoutMs: RUN_TIMEOUT_MS,
  })) as DaytonaUiTestRun
  return withRecordingSandbox(parsed, sandbox.id)
}
