"use client"

import { useMutation, useQuery } from "convex/react"
import { useEffect, useMemo, useState } from "react"

import { ACTIVE_KEY, DRAFT_RUN_KEY } from "@/components/chat/storage"
import type { ChatRecord, LiveRunRecord } from "@/components/chat/types"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  readBrowserStorage,
  removeBrowserStorage,
  writeBrowserStorage,
} from "@/lib/browser/storage"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"

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
  const autoSandboxPreset =
    sandboxPresets.find((preset) => preset.mode === "auto") ?? null
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
  const deleteThreadMutation = useMutation(api.chats.deleteThread)
  const updateThread = useMutation(api.chats.updateThread)
  const setThreadNotes = useMutation(api.chats.setThreadNotes)
  const [activeId, setActiveId] = useState<Id<"threads"> | null>(
    () => readBrowserStorage(ACTIVE_KEY) as Id<"threads"> | null
  )
  const activeRunKey = activeId ? (activeId as string) : DRAFT_RUN_KEY
  const rawActiveChat = useQuery(
    api.chats.get,
    activeId ? { threadId: activeId } : "skip"
  )
  const activeChat = rawActiveChat as ChatRecord | null | undefined
  const rawLiveRun = useQuery(
    api.codexRuns.liveForThread,
    activeId ? { threadId: activeId } : "skip"
  )
  const liveRun = rawLiveRun as LiveRunRecord | null | undefined
  const chats = useMemo(() => {
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
  }, [activeChat, chatSummaries])

  useEffect(() => {
    if (activeId) writeBrowserStorage(ACTIVE_KEY, activeId)
    else removeBrowserStorage(ACTIVE_KEY)
  }, [activeId])

  return {
    activeId,
    activeRunKey,
    appendRunMessages,
    autoSandboxPreset,
    chats,
    clearSandbox,
    completeAssistantMessage,
    createThread,
    deleteThreadMutation,
    dismissOnboardingMutation,
    ensureDefaultPresets,
    liveRun,
    presetsLoaded: rawPresets !== undefined,
    sandboxPresets,
    saveRunState,
    setActiveId,
    setThreadNotes,
    updateThread,
    viewer,
  }
}
