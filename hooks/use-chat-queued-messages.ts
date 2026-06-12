"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { QueuedMessage } from "@/components/chat/types"
import type { ChatImageAttachment } from "@/lib/chat/attachments"

type QueuedMessageMap = Record<string, QueuedMessage[]>

type SendQueuedMessage = (
  text: string,
  options: { attachments: ChatImageAttachment[]; fromQueue: true }
) => Promise<unknown>

const EMPTY_QUEUED_MESSAGES: QueuedMessage[] = []

function createQueuedMessageId() {
  return `q_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export function useChatQueuedMessages({
  activeRunPending,
  activeThreadKey,
  queueingRunKeys,
  send,
}: {
  activeRunPending: boolean
  activeThreadKey: string | null
  queueingRunKeys: Set<string>
  send: SendQueuedMessage
}) {
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessageMap>({})
  const autoSendingThreadKeysRef = useRef<Set<string>>(new Set())
  const sendRef = useRef(send)
  sendRef.current = send

  useEffect(() => {
    if (!activeThreadKey) return
    const queue = queuedMessages[activeThreadKey]
    if (!queue || queue.length === 0) return
    if (activeRunPending || queueingRunKeys.has(activeThreadKey)) return
    if (autoSendingThreadKeysRef.current.has(activeThreadKey)) return

    const next = queue[0]
    autoSendingThreadKeysRef.current.add(activeThreadKey)
    setQueuedMessages((current) => {
      const list = current[activeThreadKey]
      if (!list) return current
      const rest = list.slice(1)
      if (rest.length === 0) {
        const updated = { ...current }
        delete updated[activeThreadKey]
        return updated
      }
      return { ...current, [activeThreadKey]: rest }
    })
    void sendRef
      .current(next.text, {
        attachments: next.attachments,
        fromQueue: true,
      })
      .finally(() => {
        autoSendingThreadKeysRef.current.delete(activeThreadKey)
      })
  }, [activeRunPending, activeThreadKey, queueingRunKeys, queuedMessages])

  const activeQueuedMessages = useMemo(
    () =>
      activeThreadKey
        ? (queuedMessages[activeThreadKey] ?? EMPTY_QUEUED_MESSAGES)
        : EMPTY_QUEUED_MESSAGES,
    [activeThreadKey, queuedMessages]
  )

  const enqueueMessage = useCallback(
    (threadKey: string, text: string, attachments: ChatImageAttachment[]) => {
      setQueuedMessages((current) => {
        const list = current[threadKey] ?? []
        return {
          ...current,
          [threadKey]: [
            ...list,
            { attachments, id: createQueuedMessageId(), text },
          ],
        }
      })
    },
    []
  )

  const removeQueuedMessage = useCallback((threadKey: string, id: string) => {
    setQueuedMessages((current) => {
      const list = current[threadKey]
      if (!list) return current
      const rest = list.filter((message) => message.id !== id)
      if (rest.length === list.length) return current
      if (rest.length === 0) {
        const next = { ...current }
        delete next[threadKey]
        return next
      }
      return { ...current, [threadKey]: rest }
    })
  }, [])

  const clearQueuedMessages = useCallback((threadKey: string) => {
    setQueuedMessages((current) => {
      if (!current[threadKey]) return current
      const next = { ...current }
      delete next[threadKey]
      return next
    })
  }, [])

  const getQueuedMessage = useCallback(
    (threadKey: string, id: string) =>
      queuedMessages[threadKey]?.find((message) => message.id === id) ?? null,
    [queuedMessages]
  )

  const moveQueuedMessageToFront = useCallback(
    (threadKey: string, id: string) => {
      setQueuedMessages((current) => {
        const list = current[threadKey]
        if (!list) return current
        const target = list.find((message) => message.id === id)
        if (!target) return current
        return {
          ...current,
          [threadKey]: [target, ...list.filter((message) => message.id !== id)],
        }
      })
    },
    []
  )

  return {
    activeQueuedMessages,
    clearQueuedMessages,
    enqueueMessage,
    getQueuedMessage,
    moveQueuedMessageToFront,
    removeQueuedMessage,
  }
}
