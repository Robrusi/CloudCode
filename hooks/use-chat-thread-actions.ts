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
import { retryJsonRequest } from "@/lib/http/client-json"

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
  hideThread,
  removeThreadRunState,
  restoreThread,
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
  hideThread: (threadKey: string) => void
  removeThreadRunState: (threadId: Id<"threads">) => void
  restoreThread: (threadKey: string) => void
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
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
    setDeleteError(null)
    setPendingDeleteId(id)
  }, [])

  const cancelDeleteChat = useCallback(() => {
    setPendingDeleteId(null)
    setDeleteError(null)
  }, [])

  const confirmDeleteChat = useCallback(() => {
    const id = pendingDeleteId
    if (!id || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    void (async () => {
      const key = id as string
      const sandboxId = threadSandboxId(id)
      const wasActive = activeId === id
      // Optimistically remove the thread from the sidebar (and the open view,
      // since it drops out of the chat list) for instant feedback.
      hideThread(key)
      // Cancelling the run and closing the terminal are intended consequences
      // of a delete; do them up front so an in-flight run stops promptly.
      await cancelCodexRun(id)
      if (sandboxId) closeBrowserTerminalSession(sandboxId)

      try {
        // Retry transient failures so a dropped response or a server blip does
        // not leave the thread stranded; the server delete is idempotent.
        await retryJsonRequest(() => deleteThread({ threadId: id }))
        // Confirmed gone: clear local run bookkeeping and navigate away.
        clearRunKey(key)
        clearQueuedMessages(key)
        removeThreadRunState(id)
        if (wasActive) {
          setActiveId(null)
          setActiveFilePath(null)
          setFilesOpen(false)
          setGithubOpen(false)
          setDesktopOpen(false)
          setSshOpen(false)
          setTerminalOpen(false)
        }
        setDeleteBusy(false)
        setPendingDeleteId(null)
      } catch (error) {
        console.warn("Failed to delete thread.", error)
        // Revert the optimistic removal and keep the dialog open so the user
        // can retry or back out instead of silently losing the action.
        restoreThread(key)
        setDeleteBusy(false)
        setDeleteError(
          "Couldn't delete this chat. Check your connection and try again."
        )
      }
    })()
  }, [
    activeId,
    cancelCodexRun,
    clearQueuedMessages,
    clearRunKey,
    deleteBusy,
    deleteThread,
    hideThread,
    pendingDeleteId,
    removeThreadRunState,
    restoreThread,
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
    deleteBusy,
    deleteError,
    pendingDeleteDisplayTitle,
    pendingDeleteId,
    renameChat,
    requestDeleteChat,
  }
}
