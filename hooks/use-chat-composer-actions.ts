"use client"

import {
  useCallback,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react"

import type { Id } from "@/convex/_generated/dataModel"
import type { BranchMode, Model, Speed, Thinking } from "@/lib/chat/options"

type ThreadComposerUpdate = {
  model?: Model
  repoUrl?: string
  threadId: Id<"threads">
}

type UseChatComposerActionsOptions = {
  activeThreadId: Id<"threads"> | null
  addImageFiles: (files: File[]) => void
  input: string
  isMobile: boolean
  persistDraftBaseBranch: (value: string) => void
  persistDraftBranchMode: (value: BranchMode) => void
  persistDraftBranchName: (value: string) => void
  persistDraftModel: (value: Model) => void
  persistDraftRepo: (value: string) => void
  persistDraftSandboxPreset: (value: Id<"sandboxPresets"> | "") => void
  persistDraftSpeed: (value: Speed) => void
  persistDraftThinking: (value: Thinking) => void
  send: (message: string) => void
  setAttachmentDragActive: (active: boolean) => void
  setPromptFocused: (focused: boolean) => void
  storeModelPreference: (value: Model) => void
  updateThread: (update: ThreadComposerUpdate) => Promise<unknown> | unknown
}

function imageFiles(files: FileList | File[]) {
  return Array.from(files).filter((file) => file.type.startsWith("image/"))
}

export function useChatComposerActions({
  activeThreadId,
  addImageFiles,
  input,
  isMobile,
  persistDraftBaseBranch,
  persistDraftBranchMode,
  persistDraftBranchName,
  persistDraftModel,
  persistDraftRepo,
  persistDraftSandboxPreset,
  persistDraftSpeed,
  persistDraftThinking,
  send,
  setAttachmentDragActive,
  setPromptFocused,
  storeModelPreference,
  updateThread,
}: UseChatComposerActionsOptions) {
  const onAttachmentInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      addImageFiles(imageFiles(event.target.files ?? []))
      event.target.value = ""
    },
    [addImageFiles]
  )

  const onRepoChange = useCallback(
    (value: string) => {
      if (activeThreadId) {
        void updateThread({ repoUrl: value, threadId: activeThreadId })
        return
      }
      persistDraftRepo(value)
    },
    [activeThreadId, persistDraftRepo, updateThread]
  )

  const onBaseBranchChange = useCallback(
    (value: string) => {
      if (activeThreadId) return
      persistDraftBaseBranch(value)
    },
    [activeThreadId, persistDraftBaseBranch]
  )

  const onModelSelect = useCallback(
    (next: Model) => {
      if (activeThreadId) {
        void updateThread({ model: next, threadId: activeThreadId })
        storeModelPreference(next)
        return
      }
      persistDraftModel(next)
    },
    [activeThreadId, persistDraftModel, storeModelPreference, updateThread]
  )

  const onSandboxPresetSelect = useCallback(
    (next: Id<"sandboxPresets"> | "") => {
      if (activeThreadId) return
      persistDraftSandboxPreset(next)
    },
    [activeThreadId, persistDraftSandboxPreset]
  )

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      send(input)
    },
    [input, send]
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey || isMobile) return
      event.preventDefault()
      send(input)
    },
    [input, isMobile, send]
  )

  const onTextareaFocus = useCallback(() => {
    setPromptFocused(true)
  }, [setPromptFocused])

  const onTextareaBlur = useCallback(() => {
    setPromptFocused(false)
  }, [setPromptFocused])

  const onComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = imageFiles(event.clipboardData.files)
      if (files.length === 0) return
      event.preventDefault()
      addImageFiles(files)
    },
    [addImageFiles]
  )

  const onComposerDragOver = useCallback(
    (event: DragEvent<HTMLFormElement>) => {
      const hasFiles = Array.from(event.dataTransfer.items).some(
        (item) => item.kind === "file"
      )
      if (!hasFiles) return
      event.preventDefault()
      setAttachmentDragActive(true)
    },
    [setAttachmentDragActive]
  )

  const onComposerDragLeave = useCallback(
    (event: DragEvent<HTMLFormElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return
      }
      setAttachmentDragActive(false)
    },
    [setAttachmentDragActive]
  )

  const onComposerDrop = useCallback(
    (event: DragEvent<HTMLFormElement>) => {
      const files = imageFiles(event.dataTransfer.files)
      if (files.length === 0) return
      event.preventDefault()
      setAttachmentDragActive(false)
      addImageFiles(files)
    },
    [addImageFiles, setAttachmentDragActive]
  )

  return {
    onAttachmentInputChange,
    onBaseBranchChange,
    onBranchModeChange: persistDraftBranchMode,
    onBranchNameChange: persistDraftBranchName,
    onComposerDragLeave,
    onComposerDragOver,
    onComposerDrop,
    onComposerPaste,
    onKeyDown,
    onModelSelect,
    onRepoChange,
    onSandboxPresetSelect,
    onSpeedSelect: persistDraftSpeed,
    onSubmit,
    onTextareaBlur,
    onTextareaFocus,
    onThinkingSelect: persistDraftThinking,
  }
}
