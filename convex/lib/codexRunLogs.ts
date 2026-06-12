import type { Doc } from "../_generated/dataModel"
import type { StoredCodexRunLog } from "@/lib/codex/run-log"

const MAX_STORED_RUN_LOGS = 80
const MAX_STORED_BUILD_LOGS = 120
const MAX_STORED_LOG_MESSAGE_LENGTH = 500
const MAX_STORED_LOG_DETAIL_LENGTH = 1_500

export type { StoredCodexRunLog as StoredRunLog } from "@/lib/codex/run-log"

type RunLogCompactionPolicy = {
  maxDetailLength: number
  maxLogs: number
  maxMessageLength: number
  storedKinds: ReadonlySet<string>
}

const RUN_LOG_COMPACTION: RunLogCompactionPolicy = {
  maxDetailLength: MAX_STORED_LOG_DETAIL_LENGTH,
  maxLogs: MAX_STORED_RUN_LOGS,
  maxMessageLength: MAX_STORED_LOG_MESSAGE_LENGTH,
  storedKinds: new Set(["setup", "command", "reasoning", "result", "stderr"]),
}

const BUILD_LOG_COMPACTION: RunLogCompactionPolicy = {
  maxDetailLength: MAX_STORED_LOG_DETAIL_LENGTH,
  maxLogs: MAX_STORED_BUILD_LOGS,
  maxMessageLength: MAX_STORED_LOG_MESSAGE_LENGTH,
  storedKinds: new Set(["setup", "command", "result", "stderr"]),
}

function truncate(value: string | undefined, max: number) {
  if (!value) return undefined
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function compactRunLog(log: StoredCodexRunLog, policy: RunLogCompactionPolicy) {
  if (!policy.storedKinds.has(log.kind)) return null

  const detail = truncate(log.detail, policy.maxDetailLength)

  return {
    ...(detail ? { detail } : {}),
    kind: log.kind,
    message: truncate(log.message, policy.maxMessageLength) ?? "",
    time: log.time,
  }
}

function compactRunLogsWithPolicy(
  logs: StoredCodexRunLog[] | undefined,
  policy: RunLogCompactionPolicy
) {
  return (logs ?? [])
    .flatMap((log) => {
      const compacted = compactRunLog(log, policy)
      return compacted ? [compacted] : []
    })
    .slice(-policy.maxLogs)
}

export function compactRunLogs(logs: StoredCodexRunLog[] | undefined) {
  return compactRunLogsWithPolicy(logs, RUN_LOG_COMPACTION)
}

export function compactBuildRunLogs(logs: StoredCodexRunLog[] | undefined) {
  return compactRunLogsWithPolicy(logs, BUILD_LOG_COMPACTION)
}

export function appendBuildRunLogs(
  existingLogs: StoredCodexRunLog[] | undefined,
  incomingLogs: StoredCodexRunLog[]
) {
  const compactedIncoming = compactBuildRunLogs(incomingLogs)

  return {
    appended: compactedIncoming.length > 0,
    logs: [...(existingLogs ?? []), ...compactedIncoming].slice(
      -BUILD_LOG_COMPACTION.maxLogs
    ),
  }
}

export function compactMessageMeta(
  meta: Doc<"messages">["meta"]
): Doc<"messages">["meta"] {
  if (!meta) return undefined

  const logs = compactRunLogs(meta.logs)
  const { logs: _logs, ...rest } = meta
  void _logs

  return {
    ...rest,
    ...(logs.length ? { logs } : {}),
  }
}
