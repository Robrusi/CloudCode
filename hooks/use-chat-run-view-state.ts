"use client"

import { useMemo, useRef } from "react"

import {
  cachedStateFromLiveRun,
  hasCachedRunKey,
} from "@/components/chat/run-state"
import { EMPTY_MESSAGES } from "@/components/chat/storage"
import type {
  CachedRunState,
  ChatRecord,
  LiveRunRecord,
  Message,
  OptimisticRun,
} from "@/components/chat/types"
import type { Id } from "@/convex/_generated/dataModel"
import { useChatLiveRunReveal } from "@/hooks/use-chat-live-run-reveal"

type UseChatRunViewStateParams = {
  activeId: Id<"threads"> | null
  activeRunKey: string
  chats: ChatRecord[]
  liveRun: LiveRunRecord | null | undefined
  liveRunStates: Record<string, CachedRunState>
  optimisticRuns: Record<string, OptimisticRun>
  runningRunKeys: Record<string, true>
}

type LiveRunRef = {
  current: LiveRunRecord | null
}

export function useChatRunViewState({
  activeId,
  activeRunKey,
  chats,
  liveRun,
  liveRunStates,
  optimisticRuns,
  runningRunKeys,
}: UseChatRunViewStateParams) {
  const lastLiveRunRef = useRef<LiveRunRecord | null>(null)
  const active = useMemo(
    () => chats.find((chat) => chat.id === activeId) ?? null,
    [chats, activeId]
  )
  const visibleLiveRun = getVisibleLiveRun({
    active,
    lastLiveRunRef,
    liveRun,
  })

  const revealedLiveRunContent = useChatLiveRunReveal({
    shouldAnimateInitial: Boolean(
      visibleLiveRun && runningRunKeys[visibleLiveRun.threadId as string]
    ),
    visibleLiveRun,
  })
  const liveActiveRunState = useMemo(
    () => cachedStateFromLiveRun(visibleLiveRun),
    [visibleLiveRun]
  )
  const sidebarChats = useMemo(
    () =>
      chats.map((chat) => {
        const isLiveThread = Boolean(
          visibleLiveRun && chat.id === visibleLiveRun.threadId
        )
        return {
          ...chat,
          ...liveRunStates[chat.id as string],
          ...(isLiveThread ? liveActiveRunState : undefined),
          pending:
            isLiveThread ||
            Boolean(runningRunKeys[chat.id as string]) ||
            Boolean(chat.pending) ||
            chat.messages.some((message) => message.pending),
          lastUserMessageAt: chat.lastUserMessageAt ?? chat.createdAt,
        }
      }),
    [chats, liveActiveRunState, liveRunStates, runningRunKeys, visibleLiveRun]
  )
  const activeRunState = activeId
    ? {
        ...liveRunStates[activeId as string],
        ...liveActiveRunState,
      }
    : undefined
  const activeSandboxId = hasCachedRunKey(activeRunState, "sandboxId")
    ? (activeRunState?.sandboxId ?? null)
    : (active?.sandboxId ?? null)
  const activeFileCacheScope = activeId
    ? `thread:${activeId as string}`
    : activeSandboxId
      ? `sandbox:${activeSandboxId}`
      : null
  const rawActiveSandboxState =
    activeRunState?.sandboxState ?? active?.sandboxState
  const activeSandboxState =
    activeSandboxId && rawActiveSandboxState === "deleted"
      ? undefined
      : rawActiveSandboxState
  const baseServerMessages = active?.messages ?? EMPTY_MESSAGES
  const serverMessages = useMemo(() => {
    if (!visibleLiveRun) return baseServerMessages
    const liveRunKey = visibleLiveRun.runId as string
    const revealedContent = revealedLiveRunContent[liveRunKey] ?? ""

    return baseServerMessages.map((message) => {
      if (message.id !== visibleLiveRun.assistantMessageId) return message

      const liveMeta = {
        ...message.meta,
        ...(visibleLiveRun.branch ? { branch: visibleLiveRun.branch } : {}),
        ...(visibleLiveRun.logs.length ? { logs: visibleLiveRun.logs } : {}),
        ...(visibleLiveRun.status ? { status: visibleLiveRun.status } : {}),
      }

      return {
        ...message,
        content:
          revealedContent || (visibleLiveRun.content ? "" : message.content),
        error: Boolean(visibleLiveRun.error) || message.error,
        meta: liveMeta,
        pending: true,
      }
    })
  }, [baseServerMessages, revealedLiveRunContent, visibleLiveRun])
  const optimisticRun = optimisticRuns[activeRunKey]
  const optimisticMessages =
    optimisticRun &&
    serverMessages.length <= optimisticRun.baseMessageCount &&
    !serverMessages.some((message) => message.pending)
      ? optimisticRun.messages
      : EMPTY_MESSAGES
  const messages = useMemo(
    () => [...serverMessages, ...optimisticMessages],
    [optimisticMessages, serverMessages]
  )
  const activeLocalRunPending =
    Boolean(runningRunKeys[activeRunKey]) || Boolean(visibleLiveRun)
  const activeMessagePending =
    Boolean(active?.pending) || messages.some((message) => message.pending)
  const activeRunPending = activeLocalRunPending || activeMessagePending
  const canStopActiveRun = Boolean(active && activeRunPending)
  const empty = messages.length === 0
  const threadContentVersion = getThreadContentVersion(messages)

  return {
    active,
    activeFileCacheScope,
    activeRunPending,
    activeSandboxId,
    activeSandboxState,
    canStopActiveRun,
    empty,
    messages,
    sidebarChats,
    threadContentVersion,
    visibleLiveRun,
  }
}

function getVisibleLiveRun({
  active,
  lastLiveRunRef,
  liveRun,
}: {
  active: ChatRecord | null
  lastLiveRunRef: LiveRunRef
  liveRun: LiveRunRecord | null | undefined
}): LiveRunRecord | null {
  if (liveRun) {
    lastLiveRunRef.current = liveRun
    return liveRun
  }

  const cachedLiveRun = lastLiveRunRef.current
  if (!active || !cachedLiveRun || active.id !== cachedLiveRun.threadId) {
    return null
  }

  const liveMessage = active.messages.find(
    (message) => message.id === cachedLiveRun.assistantMessageId
  )

  if (liveMessage && !liveMessage.pending && liveMessage.content.trim()) {
    lastLiveRunRef.current = null
    return null
  }

  return cachedLiveRun
}

function getThreadContentVersion(messages: Message[]) {
  return messages
    .map((message) =>
      [
        message.id,
        message.content.length,
        message.pending ? 1 : 0,
        message.error ? 1 : 0,
        message.meta?.logs?.length ?? 0,
        message.meta?.status ?? "",
      ].join(":")
    )
    .join("|")
}
