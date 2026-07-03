import { createHash, randomUUID } from "node:crypto"
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Sandbox } from "@daytona/sdk"

import {
  getDaytonaSandbox,
  getStartedDaytonaSandbox,
  runDaytonaCommand,
  shellQuote,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"

export const DESKTOP_AGENT_RECORDING_STATE_FILE = "active-recording.json"
export const DESKTOP_AGENT_COMPLETED_RECORDING_STATE_FILE =
  "completed-recording.json"
export const DESKTOP_AGENT_RUN_STATE_FILE = "current-run.json"
const DESKTOP_RECORDING_CACHE_DIR = join(tmpdir(), "cloudcode-recordings")
const DESKTOP_RECORDING_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const DESKTOP_RECORDING_CACHE_PRUNE_MS = 10 * 60 * 1000
const DESKTOP_RECORDING_CACHE_MAX_FILES = 64

type RecordingStopInput = {
  recordingId: string
}

export type DaytonaDesktopRecordingArtifact = {
  fileName?: string
  filePath?: string
  id: string
  runId?: string
  sandboxId?: string
  status?: string
}

export type DaytonaDesktopRecordingFile = {
  fileName: string
  filePath: string
  sizeBytes: number
}

type DesktopRecordingCacheMetadata = {
  fileName?: string
}

const desktopRecordingDownloads = new Map<
  string,
  Promise<DaytonaDesktopRecordingFile>
>()
let lastDesktopRecordingCachePrune = 0

export function cleanRecordingLabel(value?: string) {
  const normalized = value?.trim()
  if (!normalized) return undefined
  return normalized.replace(/[^\w .:-]+/g, "-").slice(0, 80)
}

function desktopAgentRecordingStatePath(paths: DaytonaSandboxPaths) {
  return `${paths.codexHome}/desktop/state/${DESKTOP_AGENT_RECORDING_STATE_FILE}`
}

function desktopAgentCompletedRecordingStatePath(paths: DaytonaSandboxPaths) {
  return `${paths.codexHome}/desktop/state/${DESKTOP_AGENT_COMPLETED_RECORDING_STATE_FILE}`
}

function desktopAgentRunStatePath(paths: DaytonaSandboxPaths) {
  return `${paths.codexHome}/desktop/state/${DESKTOP_AGENT_RUN_STATE_FILE}`
}

function normalizedRunId(runId?: string) {
  const trimmed = runId?.trim()
  return trimmed || undefined
}

function recordingArtifact(
  value: unknown,
  sandboxId: string,
  fallbackId?: string,
  expectedRunId?: string
): DaytonaDesktopRecordingArtifact | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallbackId ? { id: fallbackId, sandboxId } : undefined
  }

  const record = value as Record<string, unknown>
  const id =
    typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : fallbackId
  if (!id) return undefined

  const runId =
    typeof record.runId === "string" && record.runId.trim()
      ? record.runId.trim()
      : undefined
  const requiredRunId = normalizedRunId(expectedRunId)
  if (requiredRunId && runId !== requiredRunId) return undefined

  return {
    fileName: typeof record.fileName === "string" ? record.fileName : undefined,
    filePath: typeof record.filePath === "string" ? record.filePath : undefined,
    id,
    runId,
    sandboxId:
      typeof record.sandboxId === "string" ? record.sandboxId : sandboxId,
    status: typeof record.status === "string" ? record.status : undefined,
  }
}

function recordingArtifacts(
  value: unknown,
  sandboxId: string,
  expectedRunId?: string
): DaytonaDesktopRecordingArtifact[] {
  const values = Array.isArray(value) ? value : [value]
  const recordings: DaytonaDesktopRecordingArtifact[] = []
  const seen = new Set<string>()

  for (const entry of values) {
    const recording = recordingArtifact(
      entry,
      sandboxId,
      undefined,
      expectedRunId
    )
    if (!recording?.id || seen.has(recording.id)) continue
    seen.add(recording.id)
    recordings.push(recording)
  }

  return recordings
}

function uniqueRecordingArtifacts(
  recordings: DaytonaDesktopRecordingArtifact[]
) {
  const deduped: DaytonaDesktopRecordingArtifact[] = []
  const seen = new Set<string>()

  for (const recording of recordings) {
    if (!recording.id || seen.has(recording.id)) continue
    seen.add(recording.id)
    deduped.push(recording)
  }

  return deduped
}

function desktopRecordingCacheKey(sandboxId: string, recordingId: string) {
  const sandboxHash = createHash("sha256")
    .update(sandboxId)
    .digest("hex")
    .slice(0, 16)
  const safeRecordingId =
    recordingId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) ||
    createHash("sha256").update(recordingId).digest("hex")
  return `${sandboxHash}-${safeRecordingId}`
}

function desktopRecordingCachePath(sandboxId: string, recordingId: string) {
  return join(
    DESKTOP_RECORDING_CACHE_DIR,
    `${desktopRecordingCacheKey(sandboxId, recordingId)}.mp4`
  )
}

function desktopRecordingCacheMetadataPath(filePath: string) {
  return `${filePath}.json`
}

async function readDesktopRecordingCacheMetadata(
  filePath: string
): Promise<DesktopRecordingCacheMetadata> {
  try {
    const raw = await readFile(
      desktopRecordingCacheMetadataPath(filePath),
      "utf8"
    )
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    const fileName = (parsed as DesktopRecordingCacheMetadata).fileName
    return typeof fileName === "string" && fileName.trim()
      ? { fileName: fileName.trim() }
      : {}
  } catch {
    return {}
  }
}

async function writeDesktopRecordingCacheMetadata(
  filePath: string,
  metadata: DesktopRecordingCacheMetadata
) {
  await writeFile(
    desktopRecordingCacheMetadataPath(filePath),
    JSON.stringify(metadata),
    "utf8"
  ).catch(() => undefined)
}

async function cachedDesktopRecordingFile(
  filePath: string,
  fallbackFileName: string
): Promise<DaytonaDesktopRecordingFile | undefined> {
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size < 1) return undefined
    const metadata = await readDesktopRecordingCacheMetadata(filePath)
    return {
      fileName: metadata.fileName || fallbackFileName,
      filePath,
      sizeBytes: fileStat.size,
    }
  } catch {
    return undefined
  }
}

async function removeCachedDesktopRecording(filePath: string) {
  await Promise.all([
    rm(filePath, { force: true }).catch(() => undefined),
    rm(desktopRecordingCacheMetadataPath(filePath), { force: true }).catch(
      () => undefined
    ),
  ])
}

async function pruneDesktopRecordingCache() {
  const now = Date.now()
  if (now - lastDesktopRecordingCachePrune < DESKTOP_RECORDING_CACHE_PRUNE_MS) {
    return
  }
  lastDesktopRecordingCachePrune = now

  const entries = await readdir(DESKTOP_RECORDING_CACHE_DIR, {
    withFileTypes: true,
  }).catch(() => [])
  const files = (
    await Promise.all(
      entries.flatMap((entry) => {
        if (!entry.isFile() || !entry.name.endsWith(".mp4")) return []
        const filePath = join(DESKTOP_RECORDING_CACHE_DIR, entry.name)
        return stat(filePath)
          .then((fileStat) => ({
            filePath,
            mtimeMs: fileStat.mtimeMs,
          }))
          .catch(() => null)
      })
    )
  ).filter((file): file is { filePath: string; mtimeMs: number } =>
    Boolean(file)
  )

  const expired = files.filter(
    (file) => now - file.mtimeMs > DESKTOP_RECORDING_CACHE_TTL_MS
  )
  const newestFirst = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
  const overflow = newestFirst.slice(DESKTOP_RECORDING_CACHE_MAX_FILES)
  const removals = new Set(
    [...expired, ...overflow].map((file) => file.filePath)
  )

  await Promise.all([...removals].map(removeCachedDesktopRecording))
}

async function clearDesktopAgentRecordingState(
  sandbox: Sandbox,
  statePath: string,
  signal?: AbortSignal
) {
  await runDaytonaCommand(sandbox, `rm -f ${shellQuote(statePath)}`, {
    signal,
    timeoutMs: 10_000,
  }).catch(() => undefined)
}

export function desktopAgentRunStateScript(
  paths: DaytonaSandboxPaths,
  runId?: string
) {
  const runStatePath = desktopAgentRunStatePath(paths)
  const currentRunId = normalizedRunId(runId)
  return currentRunId
    ? `mkdir -p ${shellQuote(`${paths.codexHome}/desktop/state`)} && printf '%s' ${shellQuote(JSON.stringify({ runId: currentRunId }))} > ${shellQuote(runStatePath)}`
    : `rm -f ${shellQuote(runStatePath)}`
}

export async function writeDaytonaDesktopAgentRunState(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  runId?: string,
  signal?: AbortSignal
) {
  const result = await runDaytonaCommand(
    sandbox,
    desktopAgentRunStateScript(paths, runId),
    {
      signal,
      timeoutMs: 10_000,
    }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Unable to write Daytona desktop run state."
    )
  }
}

async function readDesktopAgentRecordingState(
  sandbox: Sandbox,
  statePath: string,
  expectedRunId?: string,
  signal?: AbortSignal
) {
  const result = await runDaytonaCommand(
    sandbox,
    `[ -s ${shellQuote(statePath)} ] && cat ${shellQuote(statePath)} || true`,
    { signal, timeoutMs: 10_000 }
  )

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return undefined
  }

  try {
    return recordingArtifact(
      JSON.parse(result.stdout),
      sandbox.id,
      undefined,
      expectedRunId
    )
  } catch {
    return undefined
  }
}

async function readDesktopAgentCompletedRecordingState(
  sandbox: Sandbox,
  statePath: string,
  expectedRunId?: string,
  signal?: AbortSignal
) {
  const result = await runDaytonaCommand(
    sandbox,
    `[ -s ${shellQuote(statePath)} ] && cat ${shellQuote(statePath)} || true`,
    { signal, timeoutMs: 10_000 }
  )

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return []
  }

  try {
    return recordingArtifacts(
      JSON.parse(result.stdout),
      sandbox.id,
      expectedRunId
    )
  } catch {
    return []
  }
}

export async function stopDaytonaDesktopAgentRecordings(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal,
  runId?: string
) {
  const activeStatePath = desktopAgentRecordingStatePath(paths)
  const completedStatePath = desktopAgentCompletedRecordingStatePath(paths)
  const runStatePath = desktopAgentRunStatePath(paths)
  const expectedRunId = normalizedRunId(runId)
  const [active, completed] = await Promise.all([
    readDesktopAgentRecordingState(
      sandbox,
      activeStatePath,
      expectedRunId,
      signal
    ),
    readDesktopAgentCompletedRecordingState(
      sandbox,
      completedStatePath,
      expectedRunId,
      signal
    ),
  ])

  if (!active?.id) {
    await clearDesktopAgentRecordingState(sandbox, activeStatePath, signal)
    await clearDesktopAgentRecordingState(sandbox, completedStatePath, signal)
    await clearDesktopAgentRecordingState(sandbox, runStatePath, signal)
    return completed
  }

  const stopped = await sandbox.computerUse.recording.stop(active.id)
  await clearDesktopAgentRecordingState(sandbox, activeStatePath, signal)
  await clearDesktopAgentRecordingState(sandbox, completedStatePath, signal)
  await clearDesktopAgentRecordingState(sandbox, runStatePath, signal)
  const activeRecording = {
    ...(recordingArtifact(stopped, sandbox.id, active.id) ?? {
      ...active,
      sandboxId: sandbox.id,
      status: "completed",
    }),
    ...(expectedRunId ? { runId: expectedRunId } : {}),
  }

  return uniqueRecordingArtifacts([...completed, activeRecording])
}

export async function stopDaytonaDesktopAgentRecording(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  const recordings = await stopDaytonaDesktopAgentRecordings(
    sandbox,
    paths,
    signal
  )
  return recordings.at(-1)
}

function recordingStatusIsActive(status: unknown) {
  if (typeof status !== "string") return false
  const value = status.toLowerCase()
  return value === "active" || value === "recording" || value === "running"
}

/**
 * While the sandbox is already running, eagerly download completed recordings
 * into the on-disk cache so they load instantly (and stay viewable after the
 * sandbox stops) without anyone clicking "Load recording". Fire-and-forget:
 * the in-flight map and the cache check keep repeated polls cheap, and we reuse
 * the started sandbox handle so this never starts a stopped sandbox.
 */
function cacheCompletedRecordingsInBackground(
  sandboxId: string,
  sandbox: Sandbox,
  listed: unknown
) {
  if (!listed || typeof listed !== "object") return
  const recordings = (listed as { recordings?: unknown }).recordings
  if (!Array.isArray(recordings)) return
  for (const entry of recordings) {
    if (!entry || typeof entry !== "object") continue
    const id = (entry as { id?: unknown }).id
    if (typeof id !== "string" || !id.trim()) continue
    if (recordingStatusIsActive((entry as { status?: unknown }).status))
      continue
    void getDaytonaDesktopRecordingFile(sandboxId, id.trim(), {
      sandbox,
    }).catch(() => undefined)
  }
}

export async function listDaytonaDesktopRecordings(sandboxId: string) {
  const sandbox = await getDaytonaSandbox(sandboxId)
  await sandbox.refreshData().catch(() => undefined)
  if (sandbox.state !== "started") return { recordings: [] }
  const listed = await sandbox.computerUse.recording.list()
  cacheCompletedRecordingsInBackground(sandboxId, sandbox, listed)
  return listed
}

/**
 * Whether the sandbox is currently running, so a recording can be downloaded
 * (and played) without starting a stopped sandbox. Used to decide between
 * auto-loading a recording and showing the manual "Load recording" fallback.
 */
export async function isDaytonaDesktopSandboxRunning(sandboxId: string) {
  const sandbox = await getDaytonaSandbox(sandboxId)
  await sandbox.refreshData().catch(() => undefined)
  return sandbox.state === "started"
}

export async function stopDaytonaDesktopRecording(
  sandboxId: string,
  input: RecordingStopInput
) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  return await sandbox.computerUse.recording.stop(input.recordingId)
}

async function downloadDaytonaDesktopRecordingToCache({
  recordingId,
  sandbox,
  sandboxId,
}: {
  recordingId: string
  sandbox?: Sandbox
  sandboxId: string
}): Promise<DaytonaDesktopRecordingFile> {
  await mkdir(DESKTOP_RECORDING_CACHE_DIR, { recursive: true })
  await pruneDesktopRecordingCache()

  const cachePath = desktopRecordingCachePath(sandboxId, recordingId)
  const fallbackFileName = `${recordingId}.mp4`
  const cached = await cachedDesktopRecordingFile(cachePath, fallbackFileName)
  if (cached) return cached

  const recordingSandbox =
    sandbox ?? (await getStartedDaytonaSandbox(sandboxId))
  const recording =
    await recordingSandbox.computerUse.recording.get(recordingId)
  const fileName = recording.fileName || fallbackFileName
  const tmpPath = join(
    DESKTOP_RECORDING_CACHE_DIR,
    `${desktopRecordingCacheKey(sandboxId, recordingId)}.${randomUUID()}.tmp`
  )

  try {
    await recordingSandbox.computerUse.recording.download(recordingId, tmpPath)
    const fileStat = await stat(tmpPath)
    if (!fileStat.isFile() || fileStat.size < 1) {
      throw new Error("Daytona desktop recording download was empty.")
    }
    await rename(tmpPath, cachePath)
    await writeDesktopRecordingCacheMetadata(cachePath, { fileName })
    return {
      fileName,
      filePath: cachePath,
      sizeBytes: fileStat.size,
    }
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function getDaytonaDesktopRecordingFile(
  sandboxId: string,
  recordingId: string,
  options: { sandbox?: Sandbox } = {}
) {
  const cacheKey = desktopRecordingCacheKey(sandboxId, recordingId)
  const pending = desktopRecordingDownloads.get(cacheKey)
  if (pending) return await pending

  const download = downloadDaytonaDesktopRecordingToCache({
    recordingId,
    sandboxId,
    sandbox: options.sandbox,
  }).finally(() => {
    desktopRecordingDownloads.delete(cacheKey)
  })
  desktopRecordingDownloads.set(cacheKey, download)
  return await download
}

export async function getCachedDaytonaDesktopRecordingFile(
  sandboxId: string,
  recordingId: string
) {
  const cacheKey = desktopRecordingCacheKey(sandboxId, recordingId)
  const pending = desktopRecordingDownloads.get(cacheKey)
  if (pending) return await pending.catch(() => undefined)

  return await cachedDesktopRecordingFile(
    desktopRecordingCachePath(sandboxId, recordingId),
    `${recordingId}.mp4`
  )
}
