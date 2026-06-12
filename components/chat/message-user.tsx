"use client"

import { ImageAttachmentPreview } from "@/components/chat/message-media"
import type { ChatMessage } from "@/components/chat/message-model"
import { cn } from "@/lib/shared/utils"

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
