"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { splitStreamingTokens } from "@/components/chat/streaming"
import type { LiveRunRecord } from "@/components/chat/types"

type LiveRevealState = {
  queue: string[]
  target: string
  timer?: ReturnType<typeof setTimeout>
  visible: string
}

export function useChatLiveRunReveal({
  shouldAnimateInitial,
  visibleLiveRun,
}: {
  shouldAnimateInitial: boolean
  visibleLiveRun: LiveRunRecord | null
}) {
  const [revealedLiveRunContent, setRevealedLiveRunContent] = useState<
    Record<string, string>
  >({})
  const liveRevealRef = useRef<Record<string, LiveRevealState>>({})
  const runKey = visibleLiveRun ? (visibleLiveRun.runId as string) : null
  const target = visibleLiveRun?.content ?? ""

  const revealNextLiveToken = useCallback(function revealNextLiveToken(
    key: string
  ) {
    const state = liveRevealRef.current[key]
    if (!state) return

    const token = state.queue.shift()
    if (token === undefined) {
      state.timer = undefined
      return
    }

    state.visible += token
    setRevealedLiveRunContent((current) =>
      current[key] === state.visible
        ? current
        : { ...current, [key]: state.visible }
    )

    const isToolMarker = token.startsWith("<codex-tool>")
    const delay = isToolMarker ? 0 : token.trim() ? 16 : 4
    state.timer = setTimeout(() => revealNextLiveToken(key), delay)
  }, [])

  const scheduleLiveReveal = useCallback(
    (key: string) => {
      const state = liveRevealRef.current[key]
      if (!state || state.timer) return
      state.timer = setTimeout(() => revealNextLiveToken(key), 0)
    },
    [revealNextLiveToken]
  )

  const clearLiveRevealTimers = useCallback(() => {
    for (const state of Object.values(liveRevealRef.current)) {
      if (state.timer) clearTimeout(state.timer)
    }
  }, [])

  useEffect(() => {
    if (!runKey) return

    const current = liveRevealRef.current[runKey]

    if (!current) {
      if (target && !shouldAnimateInitial) {
        liveRevealRef.current[runKey] = {
          queue: [],
          target,
          visible: target,
        }
        setRevealedLiveRunContent((state) => ({ ...state, [runKey]: target }))
        return
      }

      liveRevealRef.current[runKey] = {
        queue: splitStreamingTokens(target),
        target,
        visible: "",
      }
      scheduleLiveReveal(runKey)
      return
    }

    if (current.target === target) return

    if (!target.startsWith(current.visible)) {
      if (current.timer) clearTimeout(current.timer)
      liveRevealRef.current[runKey] = {
        queue: [],
        target,
        visible: target,
      }
      setRevealedLiveRunContent((state) => ({ ...state, [runKey]: target }))
      return
    }

    current.target = target
    current.queue = splitStreamingTokens(target.slice(current.visible.length))
    scheduleLiveReveal(runKey)
  }, [runKey, scheduleLiveReveal, shouldAnimateInitial, target])

  useEffect(() => {
    if (runKey) return

    clearLiveRevealTimers()
    liveRevealRef.current = {}
    setRevealedLiveRunContent({})
  }, [clearLiveRevealTimers, runKey])

  useEffect(() => clearLiveRevealTimers, [clearLiveRevealTimers])

  return revealedLiveRunContent
}
