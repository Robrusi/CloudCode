import type { CodexRunLog as RunCodexLog } from "@/lib/codex/run-log"
import { compactLine as compactSharedLine } from "@/lib/shared/compact-line"
import type {
  CodexAppServerThreadItem,
  CodexAppServerTurn,
} from "@/lib/codex/app-server"
import {
  objectRecord,
  rawStringValue,
  type UnknownRecord,
} from "@/lib/shared/unknown-values"

const CODEX_APP_LOG_LINE_MAX = 500
const CODEX_APP_LOG_LINE_MARKER = "…"

export function normalizePlanSteps(value: unknown) {
  if (!Array.isArray(value)) return []

  return value.flatMap((step) => {
    const record = objectRecord(step)
    const text = stringValue(record?.step)
    if (!text) return []
    return [
      {
        status: stringValue(record?.status),
        step: text,
      },
    ]
  })
}

export function emitMissingCompletedTurnItems(
  turn: CodexAppServerTurn | undefined,
  onLog: ((log: RunCodexLog) => void | Promise<void>) | undefined,
  state: {
    commandOutputByItem: Map<string, string>
    completedLoggedItemIds: Set<string>
    fileChangesByItem: Map<
      string,
      Array<{ diff?: string; kind?: string; path?: string }>
    >
  }
) {
  if (!turn?.items?.length) return

  for (const item of turn.items) {
    if (item.id && state.completedLoggedItemIds.has(item.id)) continue

    emitItemLog(item, "completed", onLog, {
      commandOutput:
        item.type === "commandExecution" && item.id
          ? state.commandOutputByItem.get(item.id)
          : undefined,
      fileChanges:
        item.type === "fileChange" && item.id
          ? state.fileChangesByItem.get(item.id)
          : undefined,
    })

    if (item.id) {
      state.completedLoggedItemIds.add(item.id)
      state.commandOutputByItem.delete(item.id)
      state.fileChangesByItem.delete(item.id)
    }
  }
}

export function emitItemLog(
  item: CodexAppServerThreadItem,
  phase: "completed" | "started",
  onLog?: (log: RunCodexLog) => void | Promise<void>,
  fallback: {
    commandOutput?: string
    fileChanges?: Array<{ diff?: string; kind?: string; path?: string }>
  } = {}
) {
  if (item.type === "commandExecution") {
    void onLog?.({
      detail: logDetail({
        command: item.command,
        exitCode: item.exitCode,
        kind: "command_execution",
        output: item.aggregatedOutput ?? fallback.commandOutput,
        status: item.status ?? phase,
      }),
      kind: "command",
      message: "Shell command",
    })
    return
  }

  if (item.type === "fileChange") {
    if (phase !== "completed") return
    const changes = normalizeFileChanges(item.changes)
    void onLog?.({
      detail: logDetail({
        changes: changes.length ? changes : (fallback.fileChanges ?? []),
        kind: "file_change",
        status: item.status ?? phase,
      }),
      kind: "command",
      message: "File change",
    })
    return
  }

  if (item.type === "mcpToolCall") {
    const name =
      [item.server, item.tool].filter(Boolean).join(".") || "MCP tool"
    const error = objectRecord(item.error)
    const text = stringValue(error?.message) ?? toolResultText(item.result)
    void onLog?.({
      detail: logDetail({
        error: stringValue(error?.message),
        itemId: item.id,
        kind: "tool_call",
        name,
        pluginId: item.pluginId,
        recording: recordingFromToolResult(item.result),
        result: item.result,
        status: item.status ?? phase,
        text,
      }),
      kind: "command",
      message: name,
    })
    return
  }

  if (item.type === "dynamicToolCall") {
    const name = [item.namespace, item.tool].filter(Boolean).join(".") || "Tool"
    void onLog?.({
      detail: logDetail({
        itemId: item.id,
        kind: "tool_call",
        name,
        status: item.status ?? phase,
        success: item.success,
        text: toolContentText(item.contentItems),
      }),
      kind: "command",
      message: name,
    })
    return
  }

  if (item.type === "reasoning") {
    const summary = Array.isArray(item.summary)
      ? item.summary.filter(
          (value): value is string => typeof value === "string"
        )
      : []
    const content = Array.isArray(item.content)
      ? item.content.filter(
          (value): value is string => typeof value === "string"
        )
      : []
    const text = [...summary, ...content]
      .map(compactLine)
      .filter(Boolean)
      .join("\n")
    if (text) void onLog?.({ kind: "reasoning", message: text })
    return
  }

  if (item.type === "webSearch") {
    void onLog?.({
      detail: logDetail({
        itemId: item.id,
        kind: "tool_call",
        name: "Web search",
        query: item.query,
        text: item.query,
        status: phase,
      }),
      kind: "command",
      message: "Web search",
    })
    return
  }

  const record = item as Extract<CodexAppServerThreadItem, { type: string }>
  if (record.type === "plan") {
    const text = typeof record.text === "string" ? record.text : undefined
    void onLog?.({
      detail: logDetail({ kind: "plan", status: phase, text }),
      kind: "command",
      message: "Plan",
    })
    return
  }

  if (record.type === "collabAgentToolCall") {
    const tool = stringValue(record.tool) ?? "collabAgentToolCall"
    void onLog?.({
      detail: logDetail({
        agentsStates: objectRecord(record.agentsStates) ?? null,
        kind: "tool_call",
        model: stringValue(record.model),
        prompt: stringValue(record.prompt),
        reasoningEffort: stringValue(record.reasoningEffort),
        receiverThreadIds: Array.isArray(record.receiverThreadIds)
          ? record.receiverThreadIds
          : [],
        senderThreadId: stringValue(record.senderThreadId),
        status: stringValue(record.status) ?? phase,
      }),
      kind: "command",
      message: tool,
    })
    return
  }

  if (record.type === "imageView") {
    void onLog?.({
      detail: logDetail({ path: stringValue(record.path), status: phase }),
      kind: "command",
      message: "Image view",
    })
    return
  }

  if (record.type === "imageGeneration") {
    void onLog?.({
      detail: logDetail({
        result: stringValue(record.result),
        revisedPrompt: stringValue(record.revisedPrompt),
        savedPath: stringValue(record.savedPath),
        status: stringValue(record.status) ?? phase,
      }),
      kind: "command",
      message: "Image generation",
    })
    return
  }

  if (
    record.type === "enteredReviewMode" ||
    record.type === "exitedReviewMode"
  ) {
    void onLog?.({
      detail: logDetail({
        review: stringValue(record.review),
        status: phase,
      }),
      kind: "setup",
      message:
        record.type === "enteredReviewMode"
          ? "Entered review mode"
          : "Exited review mode",
    })
    return
  }

  if (record.type === "contextCompaction") {
    void onLog?.({
      kind: "setup",
      message: "Codex compacted context",
    })
  }
}

export function finalAssistantTextFromTurn(
  turn: CodexAppServerTurn | undefined
) {
  if (!turn?.items?.length) return ""

  return (
    turn.items
      .filter(
        (
          item
        ): item is Extract<
          CodexAppServerThreadItem,
          { type: "agentMessage" }
        > => item.type === "agentMessage" && typeof item.text === "string"
      )
      .at(-1)?.text ?? ""
  )
}

function toolResultText(result: unknown) {
  const record = objectRecord(result)
  const content = record?.content
  if (!Array.isArray(content)) return undefined

  return toolContentText(content)
}

function recordingFromToolResult(result: unknown) {
  const record = objectRecord(result)
  const structured = objectRecord(record?.structuredContent)
  return normalizeRecording(structured?.recording)
}

function normalizeRecording(value: unknown) {
  const record = objectRecord(value)
  const id = stringValue(record?.id)
  if (!id) return undefined

  return {
    fileName: stringValue(record?.fileName),
    filePath: stringValue(record?.filePath),
    id,
    sandboxId: stringValue(record?.sandboxId),
    status: stringValue(record?.status),
  }
}

export function normalizeFileChanges(value: unknown) {
  if (!Array.isArray(value)) return []

  return value.flatMap((change) => {
    const record = objectRecord(change)
    if (!record) return []

    const path = stringValue(record.path)
    if (!path) return []

    return [
      {
        diff: stringValue(record.diff),
        kind: normalizeFileChangeKind(record.kind),
        path,
      },
    ]
  })
}

function normalizeFileChangeKind(value: unknown) {
  if (typeof value === "string") return value

  const record = objectRecord(value)
  const type = stringValue(record?.type)
  if (type) return type

  return undefined
}

function toolContentText(content: unknown) {
  if (!Array.isArray(content)) return undefined

  const text = content
    .flatMap((item) => {
      if (typeof item === "string") return [item]
      const record = objectRecord(item)
      const text = stringValue(record?.text)
      return text ? [text] : []
    })
    .join("\n")
    .trim()

  return text || undefined
}

export function stringValue(value: unknown) {
  return rawStringValue(value)
}

export function decodeBase64Text(value: unknown) {
  const encoded = stringValue(value)
  if (!encoded) return undefined

  try {
    return Buffer.from(encoded, "base64").toString("utf8")
  } catch {
    return undefined
  }
}

export function outputLogKind(value: unknown): RunCodexLog["kind"] {
  const stream = stringValue(value)?.toLowerCase()
  return stream?.includes("err") ? "stderr" : "stdout"
}

export function compactLine(value: string) {
  return compactSharedLine(
    value,
    CODEX_APP_LOG_LINE_MAX,
    CODEX_APP_LOG_LINE_MARKER
  )
}

export function logDetail(value: UnknownRecord) {
  return JSON.stringify(value)
}
