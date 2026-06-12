"use client"

import { useCallback, useState } from "react"

import {
  type SandboxAction,
  type SandboxActionResult,
  type SandboxState,
  normalizeSandboxActionState,
} from "@/components/chat/sandbox-types"
import type {
  SaveThreadRunState,
  ThreadRunStateRef,
} from "@/components/chat/run-state"
import { closeBrowserTerminalSession } from "@/components/sandbox/terminal-session"
import type { CachedRunState, ChatRecord } from "@/components/chat/types"
import type { Id } from "@/convex/_generated/dataModel"
import { JsonRequestError, requestJson } from "@/lib/http/client-json"

type ClearSandbox = (args: { threadId: Id<"threads"> }) => Promise<unknown>

export function useChatSandboxActions({
  active,
  activeRunPending,
  activeSandboxId,
  cancelCodexRun,
  clearRunKey,
  clearSandbox,
  mergeThreadRunState,
  removeThreadRunState,
  saveRunState,
  setActiveFilePath,
  setDesktopOpen,
  setFilesOpen,
  setGithubOpen,
  setSshOpen,
  setTerminalOpen,
  threadRunStateRef,
}: {
  active: ChatRecord | null
  activeRunPending: boolean
  activeSandboxId: string | null
  cancelCodexRun: (threadId: Id<"threads">) => Promise<void>
  clearRunKey: (runKey: string) => void
  clearSandbox: ClearSandbox
  mergeThreadRunState: (
    threadId: Id<"threads">,
    patch: CachedRunState
  ) => CachedRunState
  removeThreadRunState: (threadId: Id<"threads">) => void
  saveRunState: SaveThreadRunState
  setActiveFilePath: (path: string | null) => void
  setDesktopOpen: (open: boolean) => void
  setFilesOpen: (open: boolean) => void
  setGithubOpen: (open: boolean) => void
  setSshOpen: (open: boolean) => void
  setTerminalOpen: (open: boolean) => void
  threadRunStateRef: ThreadRunStateRef
}) {
  const [pendingSandboxDelete, setPendingSandboxDelete] = useState(false)
  const [resumeBillingNotice, setResumeBillingNotice] = useState<string | null>(
    null
  )
  const [sandboxAction, setSandboxAction] = useState<SandboxAction | null>(null)

  const persistSandboxState = useCallback(
    async (
      threadId: Id<"threads">,
      sandboxId: string,
      sandboxState: SandboxState
    ) => {
      mergeThreadRunState(threadId, {
        sandboxId,
        sandboxState,
      })
      await saveRunState({
        sandboxId,
        sandboxState,
        threadId,
      }).catch((error) => {
        console.warn("Unable to save sandbox state.", error)
      })
    },
    [mergeThreadRunState, saveRunState]
  )

  const runSandboxAction = useCallback(
    async (
      action: Exclude<SandboxAction, "delete">,
      endpoint: string,
      fallbackState: SandboxState
    ): Promise<SandboxActionResult> => {
      if (!active || !activeSandboxId || sandboxAction) {
        return { message: `Unable to ${action} sandbox.`, ok: false }
      }

      const threadId = active.id
      const sandboxId = activeSandboxId
      setSandboxAction(action)
      if (action === "pause") {
        void cancelCodexRun(threadId)
        closeBrowserTerminalSession(sandboxId)
        setTerminalOpen(false)
      }

      try {
        const data = await requestJson<{
          error?: unknown
          sandboxId?: unknown
          state?: unknown
        }>(
          endpoint,
          "POST",
          { sandboxId },
          {
            fallbackError: `Failed to ${action} sandbox.`,
          }
        )

        await persistSandboxState(
          threadId,
          typeof data?.sandboxId === "string" ? data.sandboxId : sandboxId,
          normalizeSandboxActionState(data?.state, fallbackState)
        )
        return { ok: true }
      } catch (error) {
        console.warn(`Failed to ${action} sandbox.`, error)
        return {
          message:
            error instanceof Error
              ? error.message
              : `Failed to ${action} sandbox.`,
          ok: false,
          status: error instanceof JsonRequestError ? error.status : undefined,
        }
      } finally {
        setSandboxAction(null)
      }
    },
    [
      active,
      activeSandboxId,
      cancelCodexRun,
      persistSandboxState,
      sandboxAction,
      setTerminalOpen,
    ]
  )

  const pauseActiveSandbox = useCallback(() => {
    setDesktopOpen(false)
    setSshOpen(false)
    void runSandboxAction("pause", "/api/sandbox/pause", "stopped")
  }, [runSandboxAction, setDesktopOpen, setSshOpen])

  const resumeActiveSandbox = useCallback(() => {
    void (async () => {
      const result = await runSandboxAction(
        "resume",
        "/api/sandbox/resume",
        "running"
      )
      if (!result.ok && result.status === 402) {
        setResumeBillingNotice(
          "You need available billing credits to resume this Daytona sandbox."
        )
      }
    })()
  }, [runSandboxAction])

  const requestDeleteActiveSandbox = useCallback(() => {
    if (!activeSandboxId) return
    setPendingSandboxDelete(true)
  }, [activeSandboxId])

  const cancelDeleteActiveSandbox = useCallback(() => {
    setPendingSandboxDelete(false)
  }, [])

  const confirmDeleteActiveSandbox = useCallback(() => {
    const threadId = active?.id
    const sandboxId = activeSandboxId
    setPendingSandboxDelete(false)
    if (!threadId || !sandboxId || sandboxAction) return

    setSandboxAction("delete")
    void cancelCodexRun(threadId)
    clearRunKey(threadId as string)
    closeBrowserTerminalSession(sandboxId)
    setTerminalOpen(false)
    setDesktopOpen(false)
    setSshOpen(false)

    void (async () => {
      try {
        await requestJson<void>(
          "/api/sandbox/kill",
          "POST",
          { sandboxId },
          {
            fallbackError: "Failed to delete sandbox.",
          }
        )

        await clearSandbox({ threadId })
        removeThreadRunState(threadId)
        setActiveFilePath(null)
        setFilesOpen(false)
        setGithubOpen(false)
      } catch (error) {
        console.warn("Failed to delete sandbox.", error)
      } finally {
        setSandboxAction(null)
      }
    })()
  }, [
    active?.id,
    activeSandboxId,
    cancelCodexRun,
    clearRunKey,
    clearSandbox,
    removeThreadRunState,
    sandboxAction,
    setActiveFilePath,
    setDesktopOpen,
    setFilesOpen,
    setGithubOpen,
    setSshOpen,
    setTerminalOpen,
  ])

  const handleSandboxStateChange = useCallback(
    (state: SandboxState, sandboxId: string) => {
      if (!active) return

      const key = active.id as string
      const currentState =
        threadRunStateRef.current[key]?.sandboxState ?? active.sandboxState
      const currentSandboxId =
        threadRunStateRef.current[key]?.sandboxId ?? active.sandboxId
      if (currentState === state && currentSandboxId === sandboxId) return

      mergeThreadRunState(active.id, {
        sandboxId,
        sandboxState: state,
      })
      void saveRunState({
        sandboxId,
        sandboxState: state,
        threadId: active.id,
      }).catch((error) => {
        console.warn("Unable to save confirmed sandbox state.", error)
      })
    },
    [active, mergeThreadRunState, saveRunState, threadRunStateRef]
  )

  const handleSandboxMissing = useCallback(
    (sandboxId: string) => {
      if (!active) return

      const key = active.id as string
      const currentSandboxId =
        threadRunStateRef.current[key]?.sandboxId ?? active.sandboxId
      if (currentSandboxId !== sandboxId) return

      mergeThreadRunState(active.id, {
        sandboxId,
        sandboxState: "deleted",
      })
      setDesktopOpen(false)
      setSshOpen(false)

      if (activeRunPending) return

      void saveRunState({
        sandboxId,
        sandboxState: "deleted",
        threadId: active.id,
      }).catch((error) => {
        console.warn("Unable to save missing sandbox state.", error)
      })
    },
    [
      active,
      activeRunPending,
      mergeThreadRunState,
      saveRunState,
      setDesktopOpen,
      setSshOpen,
      threadRunStateRef,
    ]
  )

  const clearResumeBillingNotice = useCallback(() => {
    setResumeBillingNotice(null)
  }, [])

  return {
    cancelDeleteActiveSandbox,
    clearResumeBillingNotice,
    confirmDeleteActiveSandbox,
    handleSandboxMissing,
    handleSandboxStateChange,
    pauseActiveSandbox,
    pendingSandboxDelete,
    requestDeleteActiveSandbox,
    resumeActiveSandbox,
    resumeBillingNotice,
    sandboxAction,
  }
}
