import { unwrapShellCommand } from "@/components/chat/tool-detail-classify"
import type { ParsedLogDetail } from "@/components/chat/tool-detail-types"

export function coalesceToolDetails(
  details: ParsedLogDetail[]
): ParsedLogDetail[] {
  const coalesced: ParsedLogDetail[] = []
  for (const detail of details) {
    const previous = coalesced.at(-1)
    if (shouldMergeCommandDetails(previous, detail)) {
      coalesced[coalesced.length - 1] = mergeCommandDetails(previous, detail)
    } else if (shouldMergeToolCallDetails(previous, detail)) {
      coalesced[coalesced.length - 1] = mergeToolCallDetails(previous, detail)
    } else {
      coalesced.push(detail)
    }
  }
  return coalesced
}

function normalizeCommandKey(detail: ParsedLogDetail): string | null {
  if (detail.kind !== "command_execution") return null
  const command = detail.command?.trim()
  return command ? unwrapShellCommand(command) : null
}

function normalizedStatus(detail: ParsedLogDetail): string {
  return (
    detail.status
      ?.trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_") ?? ""
  )
}

function isStartLikeCommandDetail(detail: ParsedLogDetail): boolean {
  if (detail.kind !== "command_execution") return false
  const status = normalizedStatus(detail)
  return (
    status === "in_progress" ||
    status === "running" ||
    status === "started" ||
    status === "pending" ||
    status === "executing"
  )
}

function isTerminalCommandDetail(detail: ParsedLogDetail): boolean {
  if (detail.kind !== "command_execution") return false
  const status = normalizedStatus(detail)
  return (
    status === "completed" ||
    status === "complete" ||
    status === "succeeded" ||
    status === "success" ||
    status === "failed" ||
    status === "error" ||
    status === "cancelled" ||
    status === "canceled"
  )
}

function isToolCallDetail(detail: ParsedLogDetail): boolean {
  return detail.kind === "tool_call"
}

function toolCallIdentity(detail: ParsedLogDetail): string | null {
  if (!isToolCallDetail(detail)) return null

  const itemId = detail.itemId?.trim()
  if (itemId) return `item:${itemId}`

  const name = detail.name?.trim()
  if (name) return `name:${name}`

  return null
}

function hasToolCallPayload(detail: ParsedLogDetail): boolean {
  return Boolean(
    detail.text?.trim() || detail.output?.trim() || detail.recording
  )
}

function isStartLikeToolCallDetail(detail: ParsedLogDetail): boolean {
  const status = normalizedStatus(detail)
  return (
    isToolCallDetail(detail) &&
    (status === "in_progress" ||
      status === "running" ||
      status === "started" ||
      status === "pending" ||
      status === "executing") &&
    !hasToolCallPayload(detail)
  )
}

function shouldMergeToolCallDetails(
  previous: ParsedLogDetail | undefined,
  next: ParsedLogDetail
): previous is ParsedLogDetail {
  if (!previous || !isToolCallDetail(previous) || !isToolCallDetail(next)) {
    return false
  }

  const previousIdentity = toolCallIdentity(previous)
  const nextIdentity = toolCallIdentity(next)
  if (
    previousIdentity?.startsWith("item:") &&
    previousIdentity === nextIdentity
  ) {
    return true
  }

  if (previousIdentity && nextIdentity && previousIdentity === nextIdentity) {
    return (
      isStartLikeToolCallDetail(previous) || isStartLikeToolCallDetail(next)
    )
  }

  if (previousIdentity && nextIdentity) return false

  return isStartLikeToolCallDetail(previous) || isStartLikeToolCallDetail(next)
}

function mergeToolCallDetails(
  previous: ParsedLogDetail,
  next: ParsedLogDetail
): ParsedLogDetail {
  const preferNext =
    hasToolCallPayload(next) ||
    (!hasToolCallPayload(previous) && !isStartLikeToolCallDetail(next))
  const primary = preferNext ? next : previous
  const fallback = preferNext ? previous : next

  return {
    ...fallback,
    ...primary,
    itemId: primary.itemId ?? fallback.itemId,
    kind: "tool_call",
    name: primary.name ?? fallback.name,
    output: primary.output ?? fallback.output,
    recording: primary.recording ?? fallback.recording,
    renderKey: primary.renderKey ?? fallback.renderKey,
    status: primary.status ?? fallback.status,
    text: primary.text ?? fallback.text,
  }
}

function commandDetailCompleteness(detail: ParsedLogDetail): number {
  let score = 0
  if (detail.output?.trim()) score += 4
  if (typeof detail.exitCode === "number") score += 2
  if (isTerminalCommandDetail(detail)) score += 1
  if (isStartLikeCommandDetail(detail)) score -= 1
  return score
}

function shouldMergeCommandDetails(
  previous: ParsedLogDetail | undefined,
  next: ParsedLogDetail
): previous is ParsedLogDetail {
  if (!previous) return false
  const previousKey = normalizeCommandKey(previous)
  const nextKey = normalizeCommandKey(next)
  if (!previousKey || previousKey !== nextKey) return false

  if (isStartLikeCommandDetail(previous) || isStartLikeCommandDetail(next)) {
    return true
  }

  const previousHasResult =
    Boolean(previous.output?.trim()) || typeof previous.exitCode === "number"
  const nextHasResult =
    Boolean(next.output?.trim()) || typeof next.exitCode === "number"
  return previousHasResult !== nextHasResult
}

function mergeCommandDetails(
  previous: ParsedLogDetail,
  next: ParsedLogDetail
): ParsedLogDetail {
  if (
    isStartLikeCommandDetail(next) &&
    commandDetailCompleteness(previous) >= commandDetailCompleteness(next)
  ) {
    return previous
  }

  const preferNext =
    commandDetailCompleteness(next) >= commandDetailCompleteness(previous)
  const primary = preferNext ? next : previous
  const fallback = preferNext ? previous : next
  return {
    ...fallback,
    ...primary,
    command: primary.command ?? fallback.command,
    exitCode: primary.exitCode ?? fallback.exitCode,
    kind: "command_execution",
    output: primary.output ?? fallback.output,
    renderKey: primary.renderKey ?? fallback.renderKey,
    status: primary.status ?? fallback.status,
  }
}
