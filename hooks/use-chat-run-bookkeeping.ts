"use client"

import { useCallback, useRef, useState } from "react"

import type {
  CachedRunState,
  ChatRecord,
  OptimisticRun,
} from "@/components/chat/types"
import type { Id } from "@/convex/_generated/dataModel"
import type { ChatImageAttachment } from "@/lib/chat/attachments"
import type { Speed, Thinking } from "@/lib/chat/options"

export function useChatRunBookkeeping() {
  const cancelRequestedThreadIds = useRef(new Set<string>()).current
  const queueingRunKeys = useRef(new Set<string>()).current
  const runningRunKeysSet = useRef(new Set<string>()).current
  const threadRunStateRef = useRef<Record<string, CachedRunState>>({})
  const [runningRunKeys, setRunningRunKeys] = useState<Record<string, true>>({})
  const [liveRunStates, setLiveRunStates] = useState<
    Record<string, CachedRunState>
  >({})
  const [optimisticRuns, setOptimisticRuns] = useState<
    Record<string, OptimisticRun>
  >({})

  const mergeThreadRunState = useCallback(
    (threadId: Id<"threads">, patch: CachedRunState) => {
      const key = threadId as string
      const next = {
        ...threadRunStateRef.current[key],
        ...patch,
      }
      threadRunStateRef.current[key] = next
      setLiveRunStates((current) => ({
        ...current,
        [key]: {
          ...current[key],
          ...patch,
        },
      }))
      return next
    },
    []
  )

  const removeThreadRunState = useCallback((threadId: Id<"threads">) => {
    const key = threadId as string
    delete threadRunStateRef.current[key]
    setLiveRunStates((current) => {
      const { [key]: _removed, ...next } = current
      void _removed
      return next
    })
  }, [])

  const markRunActive = useCallback(
    (runKey: string) => {
      runningRunKeysSet.add(runKey)
      setRunningRunKeys((current) => ({ ...current, [runKey]: true }))
    },
    [runningRunKeysSet]
  )

  const showOptimisticRun = useCallback(
    (
      runKey: string,
      prompt: string,
      attachments: ChatImageAttachment[],
      baseMessageCount: number,
      runSpeed: Speed,
      runThinking: Thinking
    ) => {
      const now = Date.now()
      setOptimisticRuns((current) => ({
        ...current,
        [runKey]: {
          baseMessageCount,
          messages: [
            {
              ...(attachments.length ? { attachments } : {}),
              content: prompt,
              id: `optimistic-${runKey}-${now}-user` as Id<"messages">,
              role: "user",
            },
            {
              content: "",
              id: `optimistic-${runKey}-${now}-assistant` as Id<"messages">,
              pending: true,
              role: "assistant",
              speed: runSpeed,
              thinking: runThinking,
            },
          ],
        },
      }))
    },
    []
  )

  const clearOptimisticRun = useCallback((runKey: string) => {
    setOptimisticRuns((current) => {
      if (!current[runKey]) return current
      const { [runKey]: _removed, ...next } = current
      void _removed
      return next
    })
  }, [])

  const transferRunKey = useCallback(
    (previousKey: string, nextKey: string) => {
      if (previousKey === nextKey) return nextKey

      if (queueingRunKeys.has(previousKey)) {
        queueingRunKeys.delete(previousKey)
        queueingRunKeys.add(nextKey)
      }
      runningRunKeysSet.delete(previousKey)
      runningRunKeysSet.add(nextKey)
      setRunningRunKeys((current) => {
        const { [previousKey]: _removed, ...rest } = current
        void _removed
        return { ...rest, [nextKey]: true }
      })
      setOptimisticRuns((current) => {
        const optimistic = current[previousKey]
        if (!optimistic) return current
        const { [previousKey]: _removed, ...rest } = current
        void _removed
        return { ...rest, [nextKey]: optimistic }
      })

      return nextKey
    },
    [queueingRunKeys, runningRunKeysSet]
  )

  const clearRunKey = useCallback(
    (runKey: string) => {
      queueingRunKeys.delete(runKey)
      runningRunKeysSet.delete(runKey)
      setRunningRunKeys((current) => {
        if (!current[runKey]) return current
        const { [runKey]: _removed, ...next } = current
        void _removed
        return next
      })
    },
    [queueingRunKeys, runningRunKeysSet]
  )

  const clearSettledOptimisticRuns = useCallback((chats: ChatRecord[]) => {
    setOptimisticRuns((current) => {
      let changed = false
      const next = { ...current }

      for (const chat of chats) {
        const key = chat.id as string
        const optimistic = next[key]
        if (!optimistic) continue
        if (
          chat.messages.length > optimistic.baseMessageCount ||
          chat.pending ||
          chat.messages.some((message) => message.pending)
        ) {
          delete next[key]
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [])

  const clearInactiveRunKeys = useCallback(
    (chats: ChatRecord[], liveThreadKey?: string) => {
      setRunningRunKeys((current) => {
        let changed = false
        const nextKeys = { ...current }

        for (const chat of chats) {
          const key = chat.id as string
          const stillRunning =
            queueingRunKeys.has(key) ||
            key === liveThreadKey ||
            Boolean(chat.pending) ||
            chat.messages.some((message) => message.pending)

          if (!stillRunning && nextKeys[key]) {
            delete nextKeys[key]
            cancelRequestedThreadIds.delete(key)
            queueingRunKeys.delete(key)
            runningRunKeysSet.delete(key)
            changed = true
          }
        }

        return changed ? nextKeys : current
      })
    },
    [cancelRequestedThreadIds, queueingRunKeys, runningRunKeysSet]
  )

  return {
    cancelRequestedThreadIds,
    clearInactiveRunKeys,
    clearOptimisticRun,
    clearRunKey,
    clearSettledOptimisticRuns,
    liveRunStates,
    markRunActive,
    mergeThreadRunState,
    optimisticRuns,
    queueingRunKeys,
    removeThreadRunState,
    runningRunKeys,
    runningRunKeysSet,
    showOptimisticRun,
    threadRunStateRef,
    transferRunKey,
  }
}
