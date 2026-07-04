"use client"

import { useMutation, useQuery } from "convex/react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { ACTIVE_KEY, DRAFT_RUN_KEY } from "@/components/chat/storage"
import type { ChatRecord, LiveRunRecord } from "@/components/chat/types"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  readBrowserStorage,
  removeBrowserStorage,
  writeBrowserStorage,
} from "@/lib/browser/storage"
import { requestJson } from "@/lib/http/client-json"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"
import { useCodexRunStream } from "@/hooks/use-codex-run-stream"

const EMPTY_CHAT_RECORDS: ChatRecord[] = []
const EMPTY_SANDBOX_PRESETS: SandboxPresetRecord[] = []

export function useChatRecords() {
  const rawChatSummaries = useQuery(api.chats.list)
  const chatSummaries = rawChatSummaries
    ? (rawChatSummaries as ChatRecord[])
    : EMPTY_CHAT_RECORDS
  const rawPresets = useQuery(api.sandboxPresets.list)
  const sandboxPresets = rawPresets
    ? (rawPresets as SandboxPresetRecord[])
    : EMPTY_SANDBOX_PRESETS
  const defaultSandboxPreset =
    sandboxPresets.find((preset) => preset.isBuiltInDefault) ?? null
  const autoSandboxPreset =
    sandboxPresets.find((preset) => preset.isBuiltInAutoEnvironment) ?? null
  const viewer = useQuery(api.users.viewer)
  const dismissOnboardingMutation = useMutation(api.users.dismissOnboarding)
  const createThread = useMutation(api.chats.createThread)
  const ensureDefaultPresets = useMutation(
    api.sandboxPresets.ensureDefaultPresets
  )
  const appendRunMessages = useMutation(api.chats.appendRunMessages)
  const completeAssistantMessage = useMutation(
    api.chats.completeAssistantMessage
  )
  const saveRunState = useMutation(api.chats.saveRunState)
  const clearSandbox = useMutation(api.chats.clearSandbox)
  const deleteThreadMutation = useCallback(
    (args: { threadId: Id<"threads"> }) =>
      requestJson<{
        deleted: boolean
        sandboxIds: string[]
      }>("/api/chats/thread/delete", "POST", args, {
        fallbackError: "Failed to delete chat.",
      }),
    []
  )
  const updateThread = useMutation(api.chats.updateThread)
  const setThreadNotes = useMutation(api.chats.setThreadNotes)
  const [activeId, setActiveIdState] = useState<Id<"threads"> | null>(() => {
    // ?thread= deep-links open a specific conversation (e.g. from the review
    // comment a run posted on GitHub) and win over the remembered thread.
    if (typeof window !== "undefined") {
      const requested = new URLSearchParams(window.location.search).get(
        "thread"
      )
      if (requested) return requested as Id<"threads">
    }
    return readBrowserStorage(ACTIVE_KEY) as Id<"threads"> | null
  })
  const activeRunKey = activeId ? (activeId as string) : DRAFT_RUN_KEY
  // Identity for the scroll container and per-thread render keys. It follows
  // the active thread for ordinary navigation, but is held stable while a draft
  // is promoted into a real thread mid-send so the container and messages do
  // not remount (and flicker) at the moment the first message lands.
  const [threadViewKey, setThreadViewKey] = useState<string>(activeRunKey)

  // Navigating to a thread (or back to a fresh draft) resets the view identity
  // so scroll state starts clean for the new conversation.
  const setActiveId = useCallback((value: Id<"threads"> | null) => {
    setActiveIdState(value)
    setThreadViewKey(value ? (value as string) : DRAFT_RUN_KEY)
  }, [])

  // Promotion keeps the current view identity: a draft and the thread it
  // becomes are the same conversation, so the view must not remount.
  const promoteDraftToThread = useCallback((threadId: Id<"threads">) => {
    setActiveIdState(threadId)
  }, [])

  // Launch animation trigger. It must bump at the very start of a draft send —
  // before the optimistic messages flip the view out of the empty state — so
  // the composer holds its centered position from the first frame instead of
  // snapping to the docked layout and bouncing back. It fires only on a draft
  // send, so navigating to an existing thread never animates.
  const [composerLaunchToken, setComposerLaunchToken] = useState(0)
  const beginComposerLaunch = useCallback(() => {
    setComposerLaunchToken((token) => token + 1)
  }, [])

  // Threads removed locally while their server delete is in flight. They are
  // hidden from the sidebar immediately for instant feedback and restored if
  // the delete ultimately fails.
  const [deletingThreadIds, setDeletingThreadIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const hideThread = useCallback((threadId: string) => {
    setDeletingThreadIds((current) => {
      if (current.has(threadId)) return current
      const next = new Set(current)
      next.add(threadId)
      return next
    })
  }, [])
  const restoreThread = useCallback((threadId: string) => {
    setDeletingThreadIds((current) => {
      if (!current.has(threadId)) return current
      const next = new Set(current)
      next.delete(threadId)
      return next
    })
  }, [])

  const rawActiveChat = useQuery(
    api.chats.get,
    activeId ? { threadId: activeId } : "skip"
  )
  const activeChat = rawActiveChat as ChatRecord | null | undefined
  // The sidebar list carries no messages, so a freshly selected thread looks
  // empty until its full record loads. Track that gap so the UI can hold the
  // thread layout instead of flashing the new-chat empty state.
  const activeThreadLoading = activeId !== null && rawActiveChat === undefined
  const rawLiveRun = useQuery(
    api.codexRuns.liveForThread,
    activeId ? { threadId: activeId } : "skip"
  )
  const liveRun = useCodexRunStream(
    rawLiveRun as LiveRunRecord | null | undefined
  )
  const chats = useMemo(() => {
    const merged = (() => {
      if (!activeChat) return chatSummaries
      const seen = new Set<string>()
      const rows = chatSummaries.map((chat) => {
        if (chat.id !== activeChat.id) return chat
        seen.add(chat.id as string)
        return {
          ...chat,
          ...activeChat,
        }
      })
      return seen.has(activeChat.id as string) ? rows : [activeChat, ...rows]
    })()
    if (deletingThreadIds.size === 0) return merged
    return merged.filter((chat) => !deletingThreadIds.has(chat.id as string))
  }, [activeChat, chatSummaries, deletingThreadIds])

  useEffect(() => {
    if (activeId) writeBrowserStorage(ACTIVE_KEY, activeId)
    else removeBrowserStorage(ACTIVE_KEY)
  }, [activeId])

  // Once the server confirms a thread is gone, drop it from the pending-delete
  // set so the set stays bounded and a recreated draft is never hidden.
  useEffect(() => {
    setDeletingThreadIds((current) => {
      if (current.size === 0) return current
      const present = new Set(chatSummaries.map((chat) => chat.id as string))
      let changed = false
      const next = new Set(current)
      for (const id of current) {
        if (!present.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [chatSummaries])

  return {
    activeId,
    activeRunKey,
    activeThreadLoading,
    beginComposerLaunch,
    composerLaunchToken,
    appendRunMessages,
    autoSandboxPreset,
    chats,
    clearSandbox,
    completeAssistantMessage,
    createThread,
    defaultSandboxPreset,
    deleteThreadMutation,
    dismissOnboardingMutation,
    ensureDefaultPresets,
    hideThread,
    liveRun,
    presetsLoaded: rawPresets !== undefined,
    promoteDraftToThread,
    restoreThread,
    sandboxPresets,
    saveRunState,
    setActiveId,
    setThreadNotes,
    threadViewKey,
    updateThread,
    viewer,
  }
}
