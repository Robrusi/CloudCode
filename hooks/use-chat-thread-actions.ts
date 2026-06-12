"use client"

import { useCallback, useState } from "react"

import { limitThreadDisplayTitle } from "@/components/chat/format"
import {
  hasCachedRunKey,
  type ThreadRunStateRef,
} from "@/components/chat/run-state"
import { closeBrowserTerminalSession } from "@/components/sandbox/terminal-session"
import type { ChatRecord } from "@/components/chat/types"
import type { Id } from "@/convex/_generated/dataModel"
import { requestJson } from "@/lib/http/client-json"

type DeleteThread = (args: { threadId: Id<"threads"> }) => Promise<unknown>

type UpdateThreadTitle = (args: {
  threadId: Id<"threads">
  title: string
}) => Promise<unknown>

export function useChatThreadActions({
  activeId,
  cancelCodexRun,
  chats,
  clearQueuedMessages,
  clearRunKey,
  deleteThread,
  removeThreadRunState,
  setActiveFilePath,
  setActiveId,
  setDesktopOpen,
  setFilesOpen,
  setGithubOpen,
  setSshOpen,
  setTerminalOpen,
  threadRunStateRef,
  updateThreadTitle,
}: {
  activeId: Id<"threads"> | null
  cancelCodexRun: (threadId: Id<"threads">) => Promise<void>
  chats: ChatRecord[]
  clearQueuedMessages: (threadKey: string) => void
  clearRunKey: (runKey: string) => void
  deleteThread: DeleteThread
  removeThreadRunState: (threadId: Id<"threads">) => void
  setActiveFilePath: (path: string | null) => void
  setActiveId: (value: Id<"threads"> | null) => void
  setDesktopOpen: (open: boolean) => void
  setFilesOpen: (open: boolean) => void
  setGithubOpen: (open: boolean) => void
  setSshOpen: (open: boolean) => void
  setTerminalOpen: (open: boolean) => void
  threadRunStateRef: ThreadRunStateRef
  updateThreadTitle: UpdateThreadTitle
}) {
  const [pendingDeleteId, setPendingDeleteId] = useState<Id<"threads"> | null>(
    null
  )

  const pendingDeleteTitle = pendingDeleteId
    ? chats.find((chat) => chat.id === pendingDeleteId)?.title.trim()
    : undefined
  const pendingDeleteDisplayTitle = pendingDeleteTitle
    ? limitThreadDisplayTitle(pendingDeleteTitle)
    : null

  const threadSandboxId = useCallback(
    (id: Id<"threads">) => {
      const cachedRunState = threadRunStateRef.current[id as string]
      if (hasCachedRunKey(cachedRunState, "sandboxId")) {
        return cachedRunState?.sandboxId
      }
      return chats.find((chat) => chat.id === id)?.sandboxId
    },
    [chats, threadRunStateRef]
  )

  const requestDeleteChat = useCallback((id: Id<"threads">) => {
    setPendingDeleteId(id)
  }, [])

  const cancelDeleteChat = useCallback(() => {
    setPendingDeleteId(null)
  }, [])

  const confirmDeleteChat = useCallback(() => {
    const id = pendingDeleteId
    if (!id) return
    setPendingDeleteId(null)
    void (async () => {
      const sandboxId = threadSandboxId(id)
      await cancelCodexRun(id)
      clearRunKey(id as string)
      clearQueuedMessages(id as string)
      if (sandboxId) closeBrowserTerminalSession(sandboxId)

      try {
        if (sandboxId) {
          await requestJson(
            "/api/sandbox/kill",
            "POST",
            { sandboxId },
            {
              fallbackError: "Failed to delete sandbox.",
            }
          ).catch(() => undefined)
        }
        await deleteThread({ threadId: id })
        removeThreadRunState(id)
        if (activeId === id) {
          setActiveId(null)
          setActiveFilePath(null)
          setFilesOpen(false)
          setGithubOpen(false)
          setDesktopOpen(false)
          setSshOpen(false)
          setTerminalOpen(false)
        }
      } catch (error) {
        console.warn("Failed to delete thread sandbox resources.", error)
      }
    })()
  }, [
    activeId,
    cancelCodexRun,
    clearQueuedMessages,
    clearRunKey,
    deleteThread,
    pendingDeleteId,
    removeThreadRunState,
    setActiveFilePath,
    setActiveId,
    setDesktopOpen,
    setFilesOpen,
    setGithubOpen,
    setSshOpen,
    setTerminalOpen,
    threadSandboxId,
  ])

  const renameChat = useCallback(
    (id: Id<"threads">, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      void updateThreadTitle({ threadId: id, title: trimmed })
    },
    [updateThreadTitle]
  )

  return {
    cancelDeleteChat,
    confirmDeleteChat,
    pendingDeleteDisplayTitle,
    pendingDeleteId,
    renameChat,
    requestDeleteChat,
  }
}
