"use client"

import type {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  RefObject,
} from "react"
import { useState } from "react"

import { AnimatePresence, motion } from "motion/react"

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
  /** Fired once the new-chat settings finish collapsing on send, so the
   *  layout can sequence the composer's move to its docked position. */
  onSettingsCollapsed?: () => void
  /** Whether the new-chat git/preset settings are shown. The layout drives this
   *  so it can sequence the collapse (on send) and expand (on new chat). */
  settingsOpen?: boolean
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
  onSettingsCollapsed,
  settingsOpen,
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
  // The settings collapse needs overflow-hidden to clip the height animation,
  // but the repo/branch/preset menus open upward beyond the panel, so overflow
  // must be visible while the panel is at rest — otherwise the menus are
  // clipped and can't be used. Clip only while the height is actually animating.
  const [settingsAnimating, setSettingsAnimating] = useState(false)

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
          thinkingMenuPlacement={isMobile && !hasActiveChat ? "down" : "up"}
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

      <AnimatePresence initial={false} onExitComplete={onSettingsCollapsed}>
        {settingsOpen ? (
          <motion.div
            key="new-chat-settings"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
              opacity: { duration: 0.16, ease: "easeOut" },
            }}
            onAnimationStart={() => setSettingsAnimating(true)}
            onAnimationComplete={() => setSettingsAnimating(false)}
            className={cn(
              "-mt-3",
              settingsAnimating ? "overflow-hidden" : "overflow-visible"
            )}
          >
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
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
