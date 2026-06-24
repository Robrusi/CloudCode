import type { CodexRunLog as RunCodexLog } from "@/lib/codex/run-log"
import type {
  CodexAppServerNotification,
  CodexAppServerThreadItem,
  CodexAppServerTurn,
} from "@/lib/codex/app-server"
import {
  compactLine,
  decodeBase64Text,
  emitItemLog,
  emitMissingCompletedTurnItems,
  finalAssistantTextFromTurn,
  logDetail,
  normalizeFileChanges,
  normalizePlanSteps,
  outputLogKind,
  stringValue,
} from "@/lib/codex/app-server-turn-log-helpers"
import {
  finiteNumberValue as numberValue,
  objectRecord,
} from "@/lib/shared/unknown-values"
import {
  CODEX_USAGE_LIMIT_MESSAGE,
  isCodexUsageLimitError,
} from "@/lib/codex/usage-errors"

export type CodexAppServerTurnSummary = {
  finalAssistantText: string
  status: "completed" | "failed" | "inProgress" | "interrupted"
  turnError?: string
  turnId?: string
}

export function createCodexAppServerTurnReducer({
  onContentDelta,
  onLog,
}: {
  onContentDelta?: (delta: string) => void | Promise<void>
  onLog?: (log: RunCodexLog) => void | Promise<void>
}) {
  const assistantByItem = new Map<string, string>()
  const completedAssistantByItem = new Map<string, string>()
  const completedLoggedItemIds = new Set<string>()
  const commandOutputByItem = new Map<string, string>()
  const fileChangesByItem = new Map<
    string,
    Array<{ diff?: string; kind?: string; path?: string }>
  >()
  const mcpStartupMessages = new Set<string>()
  let completedTurn: CodexAppServerTurn | undefined
  let turnId: string | undefined

  function handleNotification(notification: CodexAppServerNotification) {
    const method = notification.method
    const params = objectRecord(notification.params)

    switch (method) {
      case "thread/started": {
        const thread = objectRecord(params?.thread)
        const threadId = stringValue(thread?.id)
        void onLog?.({
          detail: threadId ? logDetail({ threadId }) : undefined,
          kind: "setup",
          message: "Codex thread started",
        })
        return
      }
      case "thread/status/changed": {
        const status = stringValue(params?.status)
        if (status) {
          void onLog?.({
            detail: logDetail({ threadId: stringValue(params?.threadId) }),
            kind: "setup",
            message: `Codex thread status: ${status}`,
          })
        }
        return
      }
      case "thread/tokenUsage/updated": {
        return
      }
      case "turn/started": {
        const turn = objectRecord(params?.turn)
        turnId = stringValue(turn?.id) ?? turnId
        return
      }
      case "hook/started":
      case "hook/completed": {
        const run = objectRecord(params?.run)
        const hookName =
          stringValue(run?.name) || stringValue(run?.hook) || "Hook"
        void onLog?.({
          detail: logDetail({
            run: run ?? null,
            threadId: stringValue(params?.threadId),
            turnId: stringValue(params?.turnId),
          }),
          kind: "command",
          message:
            method === "hook/started"
              ? `${hookName} started`
              : `${hookName} completed`,
        })
        return
      }
      case "turn/diff/updated": {
        const diff = stringValue(params?.diff) ?? ""
        void onLog?.({
          detail: logDetail({
            diffBytes: Buffer.byteLength(diff),
            threadId: stringValue(params?.threadId),
            turnId: stringValue(params?.turnId),
          }),
          kind: "command",
          message: "Codex diff updated",
        })
        return
      }
      case "item/agentMessage/delta": {
        const itemId = stringValue(params?.itemId)
        const delta = stringValue(params?.delta)
        if (!itemId || !delta) return
        assistantByItem.set(
          itemId,
          `${assistantByItem.get(itemId) ?? ""}${delta}`
        )
        void onContentDelta?.(delta)
        return
      }
      case "item/started": {
        const item = objectRecord(params?.item) as
          | CodexAppServerThreadItem
          | undefined
        if (item) emitItemLog(item, "started", onLog)
        return
      }
      case "item/autoApprovalReview/started":
      case "item/autoApprovalReview/completed": {
        void onLog?.({
          detail: logDetail({
            action: objectRecord(params?.action) ?? null,
            decisionSource: stringValue(params?.decisionSource),
            reviewId: stringValue(params?.reviewId),
            targetItemId: stringValue(params?.targetItemId),
            threadId: stringValue(params?.threadId),
            turnId: stringValue(params?.turnId),
          }),
          kind: "command",
          message:
            method === "item/autoApprovalReview/started"
              ? "Automatic approval review started"
              : "Automatic approval review completed",
        })
        return
      }
      case "item/completed": {
        const item = objectRecord(params?.item) as
          | CodexAppServerThreadItem
          | undefined
        if (!item) return
        if (item.type === "agentMessage" && typeof item.text === "string") {
          completedAssistantByItem.set(item.id ?? "", item.text)
        }
        emitItemLog(item, "completed", onLog, {
          commandOutput:
            item.type === "commandExecution" && item.id
              ? commandOutputByItem.get(item.id)
              : undefined,
          fileChanges:
            item.type === "fileChange" && item.id
              ? fileChangesByItem.get(item.id)
              : undefined,
        })
        if (item.id) {
          completedLoggedItemIds.add(item.id)
          commandOutputByItem.delete(item.id)
          fileChangesByItem.delete(item.id)
        }
        return
      }
      case "rawResponseItem/completed": {
        const item = objectRecord(params?.item)
        const type = stringValue(item?.type)
        if (type) {
          void onLog?.({
            detail: logDetail({
              itemType: type,
              threadId: stringValue(params?.threadId),
              turnId: stringValue(params?.turnId),
            }),
            kind: "command",
            message: "Raw response item completed",
          })
        }
        return
      }
      case "command/exec/outputDelta":
      case "process/outputDelta": {
        const delta = decodeBase64Text(params?.deltaBase64)
        if (delta) {
          void onLog?.({
            detail: logDetail({
              capReached: params?.capReached === true,
              processHandle:
                stringValue(params?.processHandle) ??
                stringValue(params?.processId),
              stream: stringValue(params?.stream),
            }),
            kind: outputLogKind(params?.stream),
            message: compactLine(delta),
          })
        }
        return
      }
      case "process/exited": {
        const exitCode = numberValue(params?.exitCode)
        const stdout = stringValue(params?.stdout)
        const stderr = stringValue(params?.stderr)
        void onLog?.({
          detail: logDetail({
            exitCode,
            processHandle: stringValue(params?.processHandle),
            stderr: stderr ? compactLine(stderr) : undefined,
            stderrCapReached: params?.stderrCapReached === true,
            stdout: stdout ? compactLine(stdout) : undefined,
            stdoutCapReached: params?.stdoutCapReached === true,
          }),
          kind: exitCode && exitCode !== 0 ? "stderr" : "command",
          message:
            exitCode === undefined
              ? "Process exited"
              : `Process exited with code ${exitCode}`,
        })
        return
      }
      case "item/commandExecution/outputDelta": {
        const itemId = stringValue(params?.itemId)
        const delta = stringValue(params?.delta)
        if (!itemId || !delta) return
        commandOutputByItem.set(
          itemId,
          `${commandOutputByItem.get(itemId) ?? ""}${delta}`
        )
        const message = compactLine(delta)
        if (message) void onLog?.({ kind: "stdout", message })
        return
      }
      case "item/commandExecution/terminalInteraction": {
        void onLog?.({
          detail: logDetail({
            itemId: stringValue(params?.itemId),
            processId: stringValue(params?.processId),
            stdin: stringValue(params?.stdin),
            threadId: stringValue(params?.threadId),
            turnId: stringValue(params?.turnId),
          }),
          kind: "command",
          message: "Terminal interaction",
        })
        return
      }
      case "item/fileChange/patchUpdated": {
        const itemId = stringValue(params?.itemId)
        if (!itemId) return
        const changes = normalizeFileChanges(params?.changes)
        if (changes.length > 0) fileChangesByItem.set(itemId, changes)
        return
      }
      case "item/fileChange/outputDelta": {
        const delta = stringValue(params?.delta)
        if (delta) void onLog?.({ kind: "stdout", message: compactLine(delta) })
        return
      }
      case "serverRequest/resolved": {
        void onLog?.({
          detail: logDetail({
            requestId:
              stringValue(params?.requestId) ?? numberValue(params?.requestId),
            threadId: stringValue(params?.threadId),
          }),
          kind: "setup",
          message: "Codex server request resolved",
        })
        return
      }
      case "turn/completed": {
        const turn = objectRecord(params?.turn) as
          | CodexAppServerTurn
          | undefined
        completedTurn = turn
        turnId = stringValue(turn?.id) ?? turnId
        emitMissingCompletedTurnItems(turn, onLog, {
          commandOutputByItem,
          completedLoggedItemIds,
          fileChangesByItem,
        })
        return
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const delta = stringValue(params?.delta)
        if (delta) {
          void onLog?.({ kind: "reasoning", message: compactLine(delta) })
        }
        return
      }
      case "item/reasoning/summaryPartAdded": {
        void onLog?.({
          detail: logDetail({
            itemId: stringValue(params?.itemId),
            summaryIndex: numberValue(params?.summaryIndex),
            threadId: stringValue(params?.threadId),
            turnId: stringValue(params?.turnId),
          }),
          kind: "reasoning",
          message: "Reasoning summary part added",
        })
        return
      }
      case "item/mcpToolCall/progress": {
        const message = stringValue(params?.message)
        if (message) {
          void onLog?.({
            detail: logDetail({
              itemId: stringValue(params?.itemId),
              kind: "tool_call",
              status: "inProgress",
            }),
            kind: "command",
            message: compactLine(message),
          })
        }
        return
      }
      case "mcpServer/startupStatus/updated": {
        const name = stringValue(params?.name) ?? "MCP server"
        const status = stringValue(params?.status)
        const error = stringValue(params?.error)
        const normalizedStatus = status?.trim().toLowerCase()
        if (
          !error &&
          normalizedStatus !== "failed" &&
          normalizedStatus !== "error"
        ) {
          return
        }
        const message = compactLine(
          [name, status, error].filter(Boolean).join(": ")
        )
        if (!message || mcpStartupMessages.has(message)) return
        mcpStartupMessages.add(message)
        void onLog?.({
          kind: "stderr",
          message,
        })
        return
      }
      case "mcpServer/oauthLogin/completed": {
        const name = stringValue(params?.name) ?? "MCP server"
        const success = params?.success === true
        const error = stringValue(params?.error)
        void onLog?.({
          kind: success ? "setup" : "stderr",
          message: compactLine(
            [
              name,
              success ? "OAuth login completed" : "OAuth login failed",
              error,
            ]
              .filter(Boolean)
              .join(": ")
          ),
        })
        return
      }
      case "account/updated": {
        void onLog?.({
          detail: logDetail({
            authMode: stringValue(params?.authMode),
            planType: stringValue(params?.planType),
          }),
          kind: "setup",
          message: "Codex account updated",
        })
        return
      }
      case "account/rateLimits/updated": {
        return
      }
      case "turn/plan/updated": {
        const explanation = stringValue(params?.explanation)
        const plan = normalizePlanSteps(params?.plan)
        void onLog?.({
          detail: logDetail({ explanation, kind: "plan", plan }),
          kind: "command",
          message: "Plan updated",
        })
        return
      }
      case "item/plan/delta": {
        const delta = stringValue(params?.delta)
        if (delta) void onLog?.({ kind: "stdout", message: compactLine(delta) })
        return
      }
      case "thread/compacted": {
        void onLog?.({ kind: "setup", message: "Codex compacted context" })
        return
      }
      case "model/rerouted": {
        const fromModel = stringValue(params?.fromModel)
        const toModel = stringValue(params?.toModel)
        const reason = stringValue(params?.reason)
        void onLog?.({
          detail: logDetail({ fromModel, reason, toModel }),
          kind: "setup",
          message: compactLine(
            `Model rerouted${fromModel ? ` from ${fromModel}` : ""}${toModel ? ` to ${toModel}` : ""}`
          ),
        })
        return
      }
      case "model/verification": {
        void onLog?.({
          detail: logDetail({
            threadId: stringValue(params?.threadId),
            turnId: stringValue(params?.turnId),
            verifications: Array.isArray(params?.verifications)
              ? params.verifications
              : [],
          }),
          kind: "setup",
          message: "Model verification updated",
        })
        return
      }
      case "configWarning":
      case "deprecationNotice": {
        const summary = stringValue(params?.summary)
        const details = stringValue(params?.details)
        const path = stringValue(params?.path)
        const message = [summary, details, path].filter(Boolean).join(": ")
        if (message)
          void onLog?.({ kind: "stderr", message: compactLine(message) })
        return
      }
      case "windows/worldWritableWarning": {
        const samplePaths = Array.isArray(params?.samplePaths)
          ? params.samplePaths.filter(
              (path): path is string => typeof path === "string"
            )
          : []
        void onLog?.({
          detail: logDetail({
            extraCount: numberValue(params?.extraCount),
            failedScan: params?.failedScan === true,
            samplePaths,
          }),
          kind: "stderr",
          message: "World-writable PATH entries detected",
        })
        return
      }
      case "warning":
      case "guardianWarning": {
        const message = stringValue(params?.message)
        if (message)
          void onLog?.({ kind: "stderr", message: compactLine(message) })
        return
      }
      case "thread/archived":
      case "thread/unarchived":
      case "thread/closed":
      case "thread/deleted":
      case "skills/changed":
      case "thread/name/updated":
      case "thread/goal/updated":
      case "thread/goal/cleared":
      case "thread/settings/updated":
      case "app/list/updated":
      case "remoteControl/status/changed":
      case "externalAgentConfig/import/progress":
      case "externalAgentConfig/import/completed":
      case "fs/changed":
      case "fuzzyFileSearch/sessionUpdated":
      case "fuzzyFileSearch/sessionCompleted":
      case "thread/realtime/started":
      case "thread/realtime/itemAdded":
      case "thread/realtime/transcript/delta":
      case "thread/realtime/transcript/done":
      case "thread/realtime/outputAudio/delta":
      case "thread/realtime/sdp":
      case "thread/realtime/error":
      case "thread/realtime/closed":
      case "turn/moderationMetadata":
      case "windowsSandbox/setupCompleted":
      case "account/login/completed":
      case "model/safetyBuffering/updated":
        return
      case "error": {
        const error = objectRecord(params?.error)
        const message =
          stringValue(error?.message) ||
          stringValue(error?.additionalDetails) ||
          "Codex reported an error"
        void onLog?.({ kind: "stderr", message: compactLine(message) })
        return
      }
      default:
        return
    }
  }

  function summary(): CodexAppServerTurnSummary {
    const finalAssistantText =
      finalAssistantTextFromTurn(completedTurn) ||
      Array.from(completedAssistantByItem.values()).at(-1) ||
      Array.from(assistantByItem.values()).at(-1) ||
      ""
    const status = completedTurn?.status ?? "inProgress"
    const error = completedTurn?.error
    const codexErrorInfo =
      typeof error?.codexErrorInfo === "string" ? error.codexErrorInfo : ""
    const turnError = error
      ? isCodexUsageLimitError(
          [error.message, codexErrorInfo, error.additionalDetails]
            .filter(Boolean)
            .join("\n")
        )
        ? CODEX_USAGE_LIMIT_MESSAGE
        : [error.message, error.additionalDetails].filter(Boolean).join("\n")
      : undefined

    return {
      finalAssistantText,
      status,
      turnError,
      turnId: completedTurn?.id ?? turnId,
    }
  }

  return { handleNotification, summary }
}
