"use client"

import { ChevronDown, ChevronUp, FileText } from "lucide-react"
import { useState } from "react"

import { ImageAttachmentPreview } from "@/components/chat/message-media"
import type { ChatMessage } from "@/components/chat/message-model"
import { cn } from "@/lib/shared/utils"

/** Boilerplate prompts (a review thread's composed review prompt) collapse
 * into a small pill so the thread opens visually on the agent's report. */
export function CollapsedPromptBubble({
  label,
  message,
}: {
  label: string
  message: ChatMessage
}) {
  const [expanded, setExpanded] = useState(false)

  const toggle = (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 rounded-2xl bg-muted px-3 py-2 text-[13px] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <FileText className="size-3.5" />
        {label}
        {expanded ? (
          <ChevronUp className="size-3 opacity-60" />
        ) : (
          <ChevronDown className="size-3 opacity-60" />
        )}
      </button>
    </div>
  )

  if (!expanded) return toggle

  return (
    <div className="space-y-1.5">
      {toggle}
      <UserMessageBubble message={message} />
    </div>
  )
}

export function UserMessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-muted px-3 py-2.5 text-[14px] leading-6 break-words whitespace-pre-wrap md:text-[15px]">
        {message.attachments?.length ? (
          <div
            className={cn(
              "flex flex-wrap justify-end gap-2",
              message.attachments.length === 1 && "block"
            )}
          >
            {message.attachments.map((attachment) => (
              <ImageAttachmentPreview
                key={attachment.id}
                attachment={attachment}
                compact={message.attachments!.length > 1}
              />
            ))}
          </div>
        ) : null}
        {message.content ? (
          <div className={message.attachments?.length ? "mt-2 px-1" : "px-1"}>
            {message.content}
          </div>
        ) : null}
      </div>
    </div>
  )
}
