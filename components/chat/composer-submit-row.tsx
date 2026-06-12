"use client"

import { ArrowUp, ImagePlus, Square } from "lucide-react"

import { IconButton, Pill, ThinkingSpeedPill } from "@/components/chat/controls"
import { Button } from "@/components/ui/button"
import { MAX_CHAT_IMAGE_ATTACHMENTS } from "@/lib/chat/attachments"
import {
  MODEL_LABEL,
  MODELS,
  SPEED_LABEL,
  SPEEDS,
  THINKING_LABEL,
  THINKINGS,
  type Model,
  type Speed,
  type Thinking,
} from "@/lib/chat/options"

export function ComposerSubmitRow({
  activeRunPending,
  canStopActiveRun,
  draftAttachmentCount,
  input,
  model,
  modelOpen,
  readyAttachmentCount,
  speed,
  thinking,
  thinkingOpen,
  uploadingAttachmentCount,
  onModelSelect,
  onOpenAttachmentPicker,
  onSpeedSelect,
  onStopActiveRun,
  onThinkingSelect,
  setModelOpen,
  setThinkingOpen,
}: {
  activeRunPending: boolean
  canStopActiveRun: boolean
  draftAttachmentCount: number
  input: string
  model: Model
  modelOpen: boolean
  readyAttachmentCount: number
  speed: Speed
  thinking: Thinking
  thinkingOpen: boolean
  uploadingAttachmentCount: number
  onModelSelect: (value: Model) => void
  onOpenAttachmentPicker: () => void
  onSpeedSelect: (value: Speed) => void
  onStopActiveRun: () => void
  onThinkingSelect: (value: Thinking) => void
  setModelOpen: (value: boolean) => void
  setThinkingOpen: (value: boolean) => void
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
      <IconButton
        type="button"
        aria-label="Attach images"
        title="Attach images"
        onClick={onOpenAttachmentPicker}
        disabled={draftAttachmentCount >= MAX_CHAT_IMAGE_ATTACHMENTS}
        className="grid"
      >
        <ImagePlus className="size-[18px]" />
      </IconButton>

      <div className="ml-auto flex min-w-0 flex-nowrap items-center justify-end gap-1.5 overflow-x-auto overscroll-x-contain md:flex-wrap md:overflow-visible">
        <Pill
          header="Model"
          value={model}
          options={MODELS}
          formatTrigger={(value) => MODEL_LABEL[value]}
          formatOption={(value) => MODEL_LABEL[value]}
          open={modelOpen}
          setOpen={setModelOpen}
          onSelect={onModelSelect}
        />
        <ThinkingSpeedPill
          thinking={thinking}
          thinkingOptions={THINKINGS}
          formatThinking={(value) => THINKING_LABEL[value]}
          onSelectThinking={onThinkingSelect}
          speed={speed}
          speedOptions={SPEEDS}
          formatSpeed={(value) => SPEED_LABEL[value]}
          onSelectSpeed={onSpeedSelect}
          open={thinkingOpen}
          setOpen={setThinkingOpen}
        />

        {activeRunPending ? (
          <Button
            type="button"
            size="icon-sm"
            onClick={onStopActiveRun}
            disabled={!canStopActiveRun}
            aria-label="Stop"
            title={canStopActiveRun ? "Stop" : "Run finishing elsewhere"}
            className="size-9 rounded-full md:size-8"
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            disabled={
              (!input.trim() && readyAttachmentCount === 0) ||
              uploadingAttachmentCount > 0
            }
            aria-label="Send"
            className="size-9 rounded-full md:size-8"
          >
            <ArrowUp className="size-4" strokeWidth={2.4} />
          </Button>
        )}
      </div>
    </div>
  )
}
