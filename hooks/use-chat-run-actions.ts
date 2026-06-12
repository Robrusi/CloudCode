"use client"

import { useCallback } from "react"

import {
  hasCachedRunKey,
  type SaveThreadRunState,
  type ThreadRunStateRef,
} from "@/components/chat/run-state"
import { IMAGE_ONLY_PROMPT } from "@/components/chat/storage"
import type {
  CachedRunState,
  ChatRecord,
  QueuedMessage,
} from "@/components/chat/types"
import { closeBrowserTerminalSession } from "@/components/sandbox/terminal-session"
import type { Id } from "@/convex/_generated/dataModel"
import type { ChatImageAttachment } from "@/lib/chat/attachments"
import { buildResumeHandoff } from "@/lib/chat/resume-handoff"
import type { BranchMode, Model, Speed, Thinking } from "@/lib/chat/options"
import type { AuthStatus } from "@/lib/codex/auth"
import { postJson } from "@/lib/http/client-json"
import { useChatQueuedMessages } from "@/hooks/use-chat-queued-messages"

type CreateThread = (args: {
  attachments?: ChatImageAttachment[]
  baseBranch?: string
  branchMode: BranchMode
  model: Model
  prompt: string
  repoUrl: string
  sandboxPresetId?: Id<"sandboxPresets">
  speed: Speed
  thinking: Thinking
  title: string
}) => Promise<{
  assistantMessageId: Id<"messages">
  threadId: Id<"threads">
}>

type AppendRunMessages = (args: {
  attachments?: ChatImageAttachment[]
  prompt: string
  speed: Speed
  thinking: Thinking
  threadId: Id<"threads">
}) => Promise<{
  assistantMessageId: Id<"messages">
}>

type CompleteAssistantMessage = (args: {
  content: string
  error: true
  messageId: Id<"messages">
  sandboxId?: string
  threadId: Id<"threads">
}) => Promise<unknown>

export function useChatRunActions({
  active,
  activeId,
  activeRunKey,
  activeRunPending,
  activeSandboxId,
  appendReadyDraftAttachments,
  appendRunMessages,
  authStatus,
  cancelRequestedThreadIds,
  clearDraftAttachments,
  clearOptimisticRun,
  clearRunKey,
  completeAssistantMessage,
  createThread,
  draftBaseBranch,
  draftBranchName,
  draftModel,
  draftSpeed,
  draftThinking,
  effectiveDraftBranchMode,
  effectiveDraftSandboxPresetId,
  failedAttachmentCount,
  focusComposer,
  markRunActive,
  mergeThreadRunState,
  model,
  queueingRunKeys,
  readyDraftAttachments,
  repoUrl,
  runningRunKeysSet,
  saveRunState,
  setActiveId,
  setAttachmentError,
  setEditingRepo,
  setInput,
  setTerminalOpen,
  showOptimisticRun,
  speed,
  thinking,
  threadRunStateRef,
  transferRunKey,
  uploadingAttachmentCount,
  userLoading,
}: {
  active: ChatRecord | null
  activeId: Id<"threads"> | null
  activeRunKey: string
  activeRunPending: boolean
  activeSandboxId: string | null
  appendReadyDraftAttachments: (attachments: ChatImageAttachment[]) => void
  appendRunMessages: AppendRunMessages
  authStatus: AuthStatus | null
  cancelRequestedThreadIds: Set<string>
  clearDraftAttachments: () => void
  clearOptimisticRun: (runKey: string) => void
  clearRunKey: (runKey: string) => void
  completeAssistantMessage: CompleteAssistantMessage
  createThread: CreateThread
  draftBaseBranch: string
  draftBranchName: string
  draftModel: Model
  draftSpeed: Speed
  draftThinking: Thinking
  effectiveDraftBranchMode: BranchMode
  effectiveDraftSandboxPresetId: Id<"sandboxPresets"> | ""
  failedAttachmentCount: number
  focusComposer: () => void
  markRunActive: (runKey: string) => void
  mergeThreadRunState: (
    threadId: Id<"threads">,
    patch: CachedRunState
  ) => CachedRunState
  model: Model
  queueingRunKeys: Set<string>
  readyDraftAttachments: ChatImageAttachment[]
  repoUrl: string
  runningRunKeysSet: Set<string>
  saveRunState: SaveThreadRunState
  setActiveId: (threadId: Id<"threads">) => void
  setAttachmentError: (message: string) => void
  setEditingRepo: (value: boolean) => void
  setInput: (value: string) => void
  setTerminalOpen: (open: boolean) => void
  showOptimisticRun: (
    runKey: string,
    prompt: string,
    attachments: ChatImageAttachment[],
    baseMessageCount: number,
    runSpeed: Speed,
    runThinking: Thinking
  ) => void
  speed: Speed
  thinking: Thinking
  threadRunStateRef: ThreadRunStateRef
  transferRunKey: (previousKey: string, nextKey: string) => string
  uploadingAttachmentCount: number
  userLoading: boolean
}) {
  const {
    activeQueuedMessages,
    clearQueuedMessages,
    enqueueMessage,
    getQueuedMessage,
    moveQueuedMessageToFront,
    removeQueuedMessage,
  } = useChatQueuedMessages({
    activeRunPending,
    activeThreadKey: activeId ? (activeId as string) : null,
    queueingRunKeys,
    send,
  })

  async function send(
    prompt: string,
    options?: { attachments?: ChatImageAttachment[]; fromQueue?: boolean }
  ) {
    const trimmed = prompt.trim()
    const fromQueue = options?.fromQueue ?? false
    const attachments = options?.attachments ?? readyDraftAttachments
    const runPrompt = trimmed || IMAGE_ONLY_PROMPT
    const initialRunKey = activeRunKey
    if ((!trimmed && attachments.length === 0) || userLoading) {
      return
    }
    // A run is already in flight for the open thread: queue the message and let
    // it flush once the run settles instead of silently dropping it.
    if (!fromQueue && activeId && activeRunPending) {
      if (uploadingAttachmentCount > 0) {
        setAttachmentError("Wait for image uploads to finish before sending.")
        return
      }
      if (failedAttachmentCount > 0) {
        setAttachmentError("Remove failed image uploads before sending.")
        return
      }
      enqueueMessage(activeId as string, trimmed, attachments)
      setInput("")
      clearDraftAttachments()
      return
    }
    if (
      runningRunKeysSet.has(initialRunKey) ||
      (active
        ? Boolean(active.pending) ||
          active.messages.some((message) => message.pending)
        : false)
    ) {
      return
    }
    if (!repoUrl.trim()) {
      setEditingRepo(true)
      return
    }
    if (!authStatus?.exists) {
      window.location.href = "/api/codex-auth/login"
      return
    }
    if (uploadingAttachmentCount > 0) {
      setAttachmentError("Wait for image uploads to finish before sending.")
      return
    }
    if (failedAttachmentCount > 0) {
      setAttachmentError("Remove failed image uploads before sending.")
      return
    }
    const codexProfile = authStatus.activeProfile || authStatus.profile

    let chatId = active?.id ?? null
    let assistantMessageId: Id<"messages"> | null = null
    let runKey = initialRunKey
    let queued = false

    // When flushing the queue the composer holds whatever the user is typing
    // next, so only clear it for a direct send.
    if (!fromQueue) {
      setInput("")
      clearDraftAttachments()
    }

    queueingRunKeys.add(runKey)
    markRunActive(runKey)
    showOptimisticRun(
      runKey,
      trimmed,
      attachments,
      active?.messages.length ?? 0,
      draftSpeed,
      draftThinking
    )

    try {
      const runSandboxPresetId =
        active?.sandboxPresetId ?? effectiveDraftSandboxPresetId
      if (!chatId) {
        const trimmedBaseBranch = draftBaseBranch.trim()
        const created = await createThread({
          attachments: attachments.length ? attachments : undefined,
          baseBranch: trimmedBaseBranch || undefined,
          branchMode: effectiveDraftBranchMode,
          model: draftModel,
          prompt: trimmed,
          repoUrl: repoUrl.trim(),
          sandboxPresetId: runSandboxPresetId || undefined,
          speed: draftSpeed,
          thinking: draftThinking,
          title:
            trimmed.split("\n")[0].slice(0, 60) ||
            attachments[0]?.name ||
            "Image request",
        })
        chatId = created.threadId
        assistantMessageId = created.assistantMessageId
        runKey = transferRunKey(runKey, chatId as string)
        setActiveId(chatId)
      } else {
        const appended = await appendRunMessages({
          attachments: attachments.length ? attachments : undefined,
          prompt: trimmed,
          speed,
          thinking,
          threadId: chatId,
        })
        assistantMessageId = appended.assistantMessageId
      }

      if (!chatId || !assistantMessageId) {
        throw new Error("Unable to create a thread for this run.")
      }

      const previousAssistant = active?.messages
        .toReversed()
        .find((m) => m.role === "assistant" && (m.meta?.branch || m.meta?.diff))
      const cachedRunState = threadRunStateRef.current[chatId as string]
      const continuationBranch =
        cachedRunState?.branch ?? previousAssistant?.meta?.branch
      // Branch strategy is fixed per chat: existing chats reuse the stored mode
      // (legacy chats predate it, so default to "auto"); new chats use the
      // composer's choice. The branch name only seeds the very first run.
      const runBranchMode: BranchMode = active
        ? (active.branchMode ?? "auto")
        : effectiveDraftBranchMode
      const branchName =
        continuationBranch ??
        (runBranchMode === "custom"
          ? draftBranchName.trim() || undefined
          : undefined)
      const previousDiff = cachedRunState?.diff ?? previousAssistant?.meta?.diff
      const runSandboxId = hasCachedRunKey(cachedRunState, "sandboxId")
        ? cachedRunState?.sandboxId
        : active?.sandboxId
      if (chatId && runSandboxId) {
        mergeThreadRunState(chatId, {
          sandboxId: runSandboxId,
          sandboxState: "running",
        })
      }
      const resumeContext = buildResumeHandoff({
        branchName,
        messages: active?.messages ?? [],
        previousDiff,
        repoUrl: repoUrl.trim(),
        status: previousAssistant?.meta?.status,
      })

      await postJson(
        "/api/codex-run",
        {
          baseBranch:
            (active?.baseBranch ?? draftBaseBranch).trim() || undefined,
          branchMode: runBranchMode,
          branchName,
          codexThreadId: cachedRunState?.codexThreadId ?? active?.codexThreadId,
          assistantMessageId,
          previousDiff,
          profile: codexProfile,
          imageAttachments: attachments.length ? attachments : undefined,
          prompt: runPrompt,
          reasoningEffort: thinking,
          repoUrl: repoUrl.trim(),
          resumeContext,
          sandboxId: runSandboxId,
          sandboxPresetId: runSandboxPresetId || undefined,
          speed,
          threadId: chatId,
          model,
        },
        {},
        { fallbackError: "Unable to queue Codex run." }
      )

      queued = true
      if (cancelRequestedThreadIds.has(chatId as string)) {
        await cancelCodexRun(chatId)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Request failed."
      if (chatId && assistantMessageId) {
        const liveRunState = threadRunStateRef.current[chatId as string]
        await completeAssistantMessage({
          content: msg,
          error: true,
          messageId: assistantMessageId,
          sandboxId: liveRunState?.sandboxId,
          threadId: chatId,
        })
        if (liveRunState?.sandboxId) {
          await saveRunState({
            sandboxId: liveRunState.sandboxId,
            sandboxState: "running",
            threadId: chatId,
          }).catch((error) => {
            console.warn("Unable to save failed run sandbox state.", error)
          })
        }
      } else {
        clearOptimisticRun(runKey)
      }
    } finally {
      queueingRunKeys.delete(runKey)
      if (!queued) {
        cancelRequestedThreadIds.delete(runKey)
        clearRunKey(runKey)
      }
    }
  }

  const cancelCodexRun = useCallback(
    async (threadId: Id<"threads">) => {
      const key = threadId as string
      cancelRequestedThreadIds.add(key)
      markRunActive(key)

      const data = await postJson<{ canceled?: boolean }>(
        "/api/codex-run/cancel",
        { threadId },
        {},
        {
          fallbackError: "Unable to cancel Codex run.",
        }
      ).catch((error) => {
        console.warn("Unable to cancel Codex run.", error)
        return null
      })
      if (data?.canceled === false) {
        return
      }
    },
    [cancelRequestedThreadIds, markRunActive]
  )

  const stopActiveRun = useCallback(() => {
    if (!active) return
    void cancelCodexRun(active.id)
    if (activeSandboxId) {
      closeBrowserTerminalSession(activeSandboxId)
      setTerminalOpen(false)
    }
  }, [active, activeSandboxId, cancelCodexRun, setTerminalOpen])

  const editQueuedMessage = useCallback(
    (threadKey: string, id: string) => {
      const target = getQueuedMessage(threadKey, id)
      if (!target) return
      removeQueuedMessage(threadKey, id)
      setInput(target.text)
      if (target.attachments.length) {
        appendReadyDraftAttachments(target.attachments)
      }
      focusComposer()
    },
    [
      appendReadyDraftAttachments,
      focusComposer,
      getQueuedMessage,
      removeQueuedMessage,
      setInput,
    ]
  )

  const steerQueuedMessage = useCallback(
    (threadKey: string, id: string) => {
      moveQueuedMessageToFront(threadKey, id)
      if (active && (active.id as string) === threadKey && activeRunPending) {
        void cancelCodexRun(active.id)
      }
    },
    [active, activeRunPending, cancelCodexRun, moveQueuedMessageToFront]
  )

  return {
    activeQueuedMessages: activeQueuedMessages as QueuedMessage[],
    cancelCodexRun,
    clearQueuedMessages,
    editQueuedMessage,
    removeQueuedMessage,
    send,
    steerQueuedMessage,
    stopActiveRun,
  }
}
