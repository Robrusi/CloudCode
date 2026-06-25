"use client"

import { useEffect, useMemo, useRef } from "react"

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
  activeThreadLoading: boolean
  chats: ChatRecord[]
  liveRun: LiveRunRecord | null | undefined
  liveRunStates: Record<string, CachedRunState>
  optimisticRuns: Record<string, OptimisticRun>
  runningRunKeys: Record<string, true>
}

type LiveRunRef = {
  current: LiveRunRecord | null
}

type FinishedLiveRunSnapshot = {
  branch?: string
  content: string
  logs: LiveRunRecord["logs"]
  status?: string
}

export function useChatRunViewState({
  activeId,
  activeRunKey,
  activeThreadLoading,
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
    isCurrentLiveRunSnapshot: Boolean(liveRun && visibleLiveRun === liveRun),
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

  /* A run's streamed content/logs reach the UI through the live-run merge
     below, but the merge only targets the *current* live run's message. A
     finishing run stays `pending` server-side for a while (diff capture,
     branch push), so when a newer run takes over the live slot the previous
     message would briefly render raw — pending with empty content — and
     flash its setup line. Snapshot every live run by assistant message id and
     keep applying it to that message until the server finalizes it. */
  const finishedLiveRunsRef = useRef(new Map<string, FinishedLiveRunSnapshot>())
  if (visibleLiveRun) {
    finishedLiveRunsRef.current.set(visibleLiveRun.assistantMessageId, {
      ...(visibleLiveRun.branch ? { branch: visibleLiveRun.branch } : {}),
      content: visibleLiveRun.content,
      logs: visibleLiveRun.logs,
      ...(visibleLiveRun.status ? { status: visibleLiveRun.status } : {}),
    })
  }
  useEffect(() => {
    const snapshots = finishedLiveRunsRef.current
    if (snapshots.size === 0) return
    for (const message of baseServerMessages) {
      if (!message.pending) snapshots.delete(message.id)
    }
  }, [baseServerMessages])

  const serverMessages = useMemo(() => {
    if (!visibleLiveRun && finishedLiveRunsRef.current.size === 0) {
      return baseServerMessages
    }
    const liveRunKey = visibleLiveRun ? (visibleLiveRun.runId as string) : ""
    const revealedContent = revealedLiveRunContent[liveRunKey] ?? ""

    return baseServerMessages.map((message) => {
      if (visibleLiveRun && message.id === visibleLiveRun.assistantMessageId) {
        const liveMeta = {
          ...message.meta,
          ...(visibleLiveRun.branch ? { branch: visibleLiveRun.branch } : {}),
          ...(visibleLiveRun.logs.length ? { logs: visibleLiveRun.logs } : {}),
          ...(visibleLiveRun.status ? { status: visibleLiveRun.status } : {}),
        }
        /* While the run is current, an empty reveal means "animate from the
           start". Once the run is only visible through the cache (a newer
           send is taking over), show the full content immediately — an empty
           frame here would flash the setup line on a finished message. */
        const settledContent =
          liveRun === visibleLiveRun ? "" : visibleLiveRun.content

        return {
          ...message,
          content:
            revealedContent ||
            (visibleLiveRun.content ? settledContent : message.content),
          error: Boolean(visibleLiveRun.error) || message.error,
          meta: liveMeta,
          pending: true,
        }
      }

      if (message.pending && !message.content.trim()) {
        const snapshot = finishedLiveRunsRef.current.get(message.id)
        if (snapshot?.content) {
          return {
            ...message,
            content: snapshot.content,
            meta: {
              ...message.meta,
              ...(snapshot.branch ? { branch: snapshot.branch } : {}),
              ...(snapshot.logs.length ? { logs: snapshot.logs } : {}),
              ...(snapshot.status ? { status: snapshot.status } : {}),
            },
          }
        }
      }

      return message
    })
  }, [baseServerMessages, liveRun, revealedLiveRunContent, visibleLiveRun])
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
  // Hold the thread layout while a selected thread's full record (with its
  // messages) is still loading; otherwise the new-chat empty state flashes in
  // the gap between selecting a thread and its messages arriving.
  const empty = messages.length === 0 && !activeThreadLoading
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
