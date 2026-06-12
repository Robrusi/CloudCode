"use client"

import type {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  RefObject,
} from "react"

import { DraftAttachmentList } from "@/components/chat/composer-attachments"
import { QueuedMessages } from "@/components/chat/composer-queue"
import { NewChatComposerSettings } from "@/components/chat/composer-settings"
import { ComposerSubmitRow } from "@/components/chat/composer-submit-row"
import type {
  DraftImageAttachment,
  QueuedMessage,
} from "@/components/chat/types"
import type { Id } from "@/convex/_generated/dataModel"
import { CHAT_IMAGE_ATTACHMENT_ACCEPT } from "@/components/chat/storage"
import {
  type BranchMode,
  type Model,
  type Speed,
  type Thinking,
} from "@/lib/chat/options"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"
import { cn } from "@/lib/shared/utils"

export type ChatComposerProps = {
  activeQueuedMessages: QueuedMessage[]
  activeRunPending: boolean
  activeThreadKey: string | null
  attachmentDragActive: boolean
  attachmentError: string
  baseBranch: string
  branchTargetOpen: boolean
  canStopActiveRun: boolean
  draftAttachments: DraftImageAttachment[]
  draftBranchMode: BranchMode
  draftBranchName: string
  editingRepo: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  hasActiveChat: boolean
  input: string
  isMobile: boolean
  model: Model
  modelOpen: boolean
  presetOpen: boolean
  readyAttachmentCount: number
  repoUrl: string
  sandboxPresetId: Id<"sandboxPresets"> | ""
  sandboxPresets: SandboxPresetRecord[]
  speed: Speed
  textareaRef: RefObject<HTMLTextAreaElement | null>
  thinking: Thinking
  thinkingOpen: boolean
  uploadingAttachmentCount: number
  onAttachmentInputChange: (event: ChangeEvent<HTMLInputElement>) => void
  onBaseBranchChange: (value: string) => void
  onBranchModeChange: (value: BranchMode) => void
  onBranchNameChange: (value: string) => void
  onComposerDragLeave: (event: DragEvent<HTMLFormElement>) => void
  onComposerDragOver: (event: DragEvent<HTMLFormElement>) => void
  onComposerDrop: (event: DragEvent<HTMLFormElement>) => void
  onComposerPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onEditQueuedMessage: (threadKey: string, queuedId: string) => void
  onInputChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onModelSelect: (value: Model) => void
  onOpenAttachmentPicker: () => void
  onRemoveDraftAttachment: (attachmentId: string) => void
  onRemoveQueuedMessage: (threadKey: string, queuedId: string) => void
  onRepoChange: (value: string) => void
  onSandboxPresetSelect: (value: Id<"sandboxPresets"> | "") => void
  onSpeedSelect: (value: Speed) => void
  onSteerQueuedMessage: (threadKey: string, queuedId: string) => void
  onStopActiveRun: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onTextareaBlur: () => void
  onTextareaFocus: () => void
  onThinkingSelect: (value: Thinking) => void
  setBranchTargetOpen: (value: boolean) => void
  setEditingRepo: (value: boolean) => void
  setModelOpen: (value: boolean) => void
  setPresetOpen: (value: boolean) => void
  setThinkingOpen: (value: boolean) => void
}

export function ChatComposer({
  activeQueuedMessages,
  activeRunPending,
  activeThreadKey,
  attachmentDragActive,
  attachmentError,
  baseBranch,
  branchTargetOpen,
  canStopActiveRun,
  draftAttachments,
  draftBranchMode,
  draftBranchName,
  editingRepo,
  fileInputRef,
  hasActiveChat,
  input,
  isMobile,
  model,
  modelOpen,
  presetOpen,
  readyAttachmentCount,
  repoUrl,
  sandboxPresetId,
  sandboxPresets,
  speed,
  textareaRef,
  thinking,
  thinkingOpen,
  uploadingAttachmentCount,
  onAttachmentInputChange,
  onBaseBranchChange,
  onBranchModeChange,
  onBranchNameChange,
  onComposerDragLeave,
  onComposerDragOver,
  onComposerDrop,
  onComposerPaste,
  onEditQueuedMessage,
  onInputChange,
  onKeyDown,
  onModelSelect,
  onOpenAttachmentPicker,
  onRemoveDraftAttachment,
  onRemoveQueuedMessage,
  onRepoChange,
  onSandboxPresetSelect,
  onSpeedSelect,
  onSteerQueuedMessage,
  onStopActiveRun,
  onSubmit,
  onTextareaBlur,
  onTextareaFocus,
  onThinkingSelect,
  setBranchTargetOpen,
  setEditingRepo,
  setModelOpen,
  setPresetOpen,
  setThinkingOpen,
}: ChatComposerProps) {
  return (
    <div className="pointer-events-auto w-full max-w-3xl rounded-3xl">
      {activeQueuedMessages.length > 0 && activeThreadKey ? (
        <QueuedMessages
          messages={activeQueuedMessages}
          threadKey={activeThreadKey}
          onEdit={onEditQueuedMessage}
          onRemove={onRemoveQueuedMessage}
          onSteer={onSteerQueuedMessage}
        />
      ) : null}
      <form
        onSubmit={onSubmit}
        onDragOver={onComposerDragOver}
        onDragLeave={onComposerDragLeave}
        onDrop={onComposerDrop}
        className={cn(
          "relative z-[1] w-full rounded-3xl border border-field/70 bg-background transition-colors focus-within:border-border",
          attachmentDragActive && "border-border bg-muted/35"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          aria-label="Attach images"
          accept={CHAT_IMAGE_ATTACHMENT_ACCEPT}
          multiple
          className="sr-only"
          onChange={onAttachmentInputChange}
        />
        <DraftAttachmentList
          attachments={draftAttachments}
          onRemove={onRemoveDraftAttachment}
        />
        {attachmentError ? (
          <div className="px-4 pt-2 text-xs text-destructive">
            {attachmentError}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={input}
          aria-label="Message"
          autoComplete="off"
          name="message"
          onChange={(event) => onInputChange(event.target.value)}
          onPaste={onComposerPaste}
          onKeyDown={onKeyDown}
          onFocus={onTextareaFocus}
          onBlur={onTextareaBlur}
          rows={1}
          placeholder={
            hasActiveChat ? "Ask for follow-up changes" : "Ask anything…"
          }
          enterKeyHint={isMobile ? "enter" : "send"}
          className="block min-h-16 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base leading-6 outline-none placeholder:text-muted-foreground/70 md:min-h-20 md:px-5 md:pt-4 md:text-[15px]"
        />

        <ComposerSubmitRow
          activeRunPending={activeRunPending}
          canStopActiveRun={canStopActiveRun}
          draftAttachmentCount={draftAttachments.length}
          input={input}
          model={model}
          modelOpen={modelOpen}
          readyAttachmentCount={readyAttachmentCount}
          speed={speed}
          thinking={thinking}
          thinkingOpen={thinkingOpen}
          uploadingAttachmentCount={uploadingAttachmentCount}
          onModelSelect={onModelSelect}
          onOpenAttachmentPicker={onOpenAttachmentPicker}
          onSpeedSelect={onSpeedSelect}
          onStopActiveRun={onStopActiveRun}
          onThinkingSelect={onThinkingSelect}
          setModelOpen={setModelOpen}
          setThinkingOpen={setThinkingOpen}
        />
      </form>

      {hasActiveChat ? null : (
        <NewChatComposerSettings
          baseBranch={baseBranch}
          branchTargetOpen={branchTargetOpen}
          draftBranchMode={draftBranchMode}
          draftBranchName={draftBranchName}
          editingRepo={editingRepo}
          presetOpen={presetOpen}
          repoUrl={repoUrl}
          sandboxPresetId={sandboxPresetId}
          sandboxPresets={sandboxPresets}
          onBaseBranchChange={onBaseBranchChange}
          onBranchModeChange={onBranchModeChange}
          onBranchNameChange={onBranchNameChange}
          onRepoChange={onRepoChange}
          onSandboxPresetSelect={onSandboxPresetSelect}
          setBranchTargetOpen={setBranchTargetOpen}
          setEditingRepo={setEditingRepo}
          setPresetOpen={setPresetOpen}
        />
      )}
    </div>
  )
}
