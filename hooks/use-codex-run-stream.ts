"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "convex/react"

import type { LiveRunRecord } from "@/components/chat/types"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { StoredCodexRunLog } from "@/lib/codex/run-log"

const MAX_LIVE_LOGS = 80

type RunStreamState = {
  content: string
  lastStreamId?: string
  logs: StoredCodexRunLog[]
}

type StreamMessage =
  | {
      content: string
      lastStreamId?: string
      logs?: StoredCodexRunLog[]
      status?: string
      streamId?: string
      type: "checkpoint"
    }
  | {
      delta: string
      streamId?: string
      type: "content_delta"
    }
  | {
      log: StoredCodexRunLog
      streamId?: string
      type: "log"
    }
  | {
      streamId?: string
      type: "done" | "error" | "reconnect" | "unavailable"
    }

function streamUrl(runId: string, after?: string) {
  const params = new URLSearchParams({ runId })
  if (after) params.set("after", after)
  return `/api/codex-run/stream?${params.toString()}`
}

function streamIdParts(value: string) {
  const [ms = "0", seq = "0"] = value.split("-", 2)
  const parsedMs = Number(ms)
  const parsedSeq = Number(seq)
  return [
    Number.isFinite(parsedMs) ? parsedMs : 0,
    Number.isFinite(parsedSeq) ? parsedSeq : 0,
  ] as const
}

function compareStreamIds(left: string | undefined, right: string | undefined) {
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1

  const leftParts = streamIdParts(left)
  const rightParts = streamIdParts(right)

  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]
    if (leftPart > rightPart) return 1
    if (leftPart < rightPart) return -1
  }

  return 0
}

function latestStreamId(left: string | undefined, right: string | undefined) {
  return compareStreamIds(left, right) >= 0 ? left : right
}

function streamMessage(value: string): StreamMessage | null {
  try {
    const parsed = JSON.parse(value) as StreamMessage
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

export function useCodexRunStream(
  liveRun: LiveRunRecord | null | undefined
): LiveRunRecord | null | undefined {
  const [states, setStates] = useState<Record<string, RunStreamState>>({})
  const [fallbackRunId, setFallbackRunId] = useState<Id<"codexRuns"> | null>(
    null
  )
  const liveRunRef = useRef(liveRun)
  const statesRef = useRef(states)
  const runKey = liveRun ? (liveRun.runId as string) : null
  const fallbackCheckpoint = useQuery(
    api.codexRuns.liveCheckpointForRun,
    fallbackRunId ? { runId: fallbackRunId } : "skip"
  )

  useEffect(() => {
    liveRunRef.current = liveRun
  }, [liveRun])

  useEffect(() => {
    statesRef.current = states
  }, [states])

  useEffect(() => {
    if (!liveRun) {
      setFallbackRunId(null)
      return
    }

    setFallbackRunId((current) =>
      current && current !== liveRun.runId ? null : current
    )
  }, [liveRun])

  useEffect(() => {
    if (!liveRun || !runKey) return

    setStates((current) => {
      const existing = current[runKey]
      const content =
        !existing || liveRun.content.length > existing.content.length
          ? liveRun.content
          : existing.content
      const logs =
        !existing || liveRun.logs.length > existing.logs.length
          ? liveRun.logs
          : existing.logs
      const lastStreamId = existing?.lastStreamId ?? liveRun.lastStreamId

      if (
        existing &&
        existing.content === content &&
        existing.logs === logs &&
        existing.lastStreamId === lastStreamId
      ) {
        return current
      }

      return {
        ...current,
        [runKey]: {
          content,
          lastStreamId,
          logs,
        },
      }
    })
  }, [liveRun, runKey])

  useEffect(() => {
    if (!fallbackCheckpoint || !runKey) return

    setStates((current) => {
      const existing = current[runKey]
      const content =
        !existing || fallbackCheckpoint.content.length > existing.content.length
          ? fallbackCheckpoint.content
          : existing.content
      const logs =
        !existing || fallbackCheckpoint.logs.length > existing.logs.length
          ? fallbackCheckpoint.logs
          : existing.logs
      const lastStreamId = latestStreamId(
        existing?.lastStreamId,
        fallbackCheckpoint.lastStreamId
      )

      if (
        existing &&
        existing.content === content &&
        existing.logs === logs &&
        existing.lastStreamId === lastStreamId
      ) {
        return current
      }

      return {
        ...current,
        [runKey]: {
          content,
          lastStreamId,
          logs,
        },
      }
    })
  }, [fallbackCheckpoint, runKey])

  useEffect(() => {
    const initialLiveRun = liveRunRef.current
    if (!initialLiveRun || !runKey || typeof EventSource === "undefined") {
      if (initialLiveRun) setFallbackRunId(initialLiveRun.runId)
      return
    }

    const after =
      statesRef.current[runKey]?.lastStreamId ?? initialLiveRun.lastStreamId
    const source = new EventSource(streamUrl(runKey, after))

    source.onmessage = (event) => {
      const message = streamMessage(event.data)
      if (!message) return
      const streamId = (message.streamId ?? event.lastEventId) || undefined

      if (message.type === "checkpoint") {
        setStates((current) => {
          const baseline = liveRunRef.current ?? initialLiveRun
          const existing = current[runKey] ?? {
            content: baseline.content,
            logs: baseline.logs,
          }
          const checkpointLogs = message.logs ?? []
          return {
            ...current,
            [runKey]: {
              content:
                message.content.length > existing.content.length
                  ? message.content
                  : existing.content,
              lastStreamId: latestStreamId(
                existing.lastStreamId,
                streamId ?? message.lastStreamId
              ),
              logs:
                checkpointLogs.length > existing.logs.length
                  ? checkpointLogs
                  : existing.logs,
            },
          }
        })
        return
      }

      if (message.type === "content_delta") {
        setStates((current) => {
          const baseline = liveRunRef.current ?? initialLiveRun
          const existing = current[runKey] ?? {
            content: baseline.content,
            logs: baseline.logs,
          }
          return {
            ...current,
            [runKey]: {
              content: `${existing.content}${message.delta}`,
              lastStreamId: streamId ?? existing.lastStreamId,
              logs: existing.logs,
            },
          }
        })
        return
      }

      if (message.type === "log") {
        setStates((current) => {
          const baseline = liveRunRef.current ?? initialLiveRun
          const existing = current[runKey] ?? {
            content: baseline.content,
            logs: baseline.logs,
          }
          return {
            ...current,
            [runKey]: {
              content: existing.content,
              lastStreamId: streamId ?? existing.lastStreamId,
              logs: [...existing.logs, message.log].slice(-MAX_LIVE_LOGS),
            },
          }
        })
        return
      }

      if (message.type === "done" || message.type === "error") {
        if (message.type === "error") setFallbackRunId(initialLiveRun.runId)
        source.close()
        return
      }

      if (message.type === "unavailable") {
        setFallbackRunId(initialLiveRun.runId)
        source.close()
      }
    }

    return () => source.close()
  }, [runKey])

  return useMemo(() => {
    if (!liveRun || !runKey) return liveRun
    const streamed = states[runKey]
    if (!streamed) return liveRun

    return {
      ...liveRun,
      content: streamed.content || liveRun.content,
      lastStreamId: streamed.lastStreamId ?? liveRun.lastStreamId,
      logs: streamed.logs.length ? streamed.logs : liveRun.logs,
    }
  }, [liveRun, runKey, states])
}
