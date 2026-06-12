"use client"

import { CornerDownRight, Pencil, Trash2 } from "lucide-react"

import { IconButton } from "@/components/chat/controls"
import type { QueuedMessage } from "@/components/chat/types"

export function QueuedMessages({
  messages,
  onEdit,
  onRemove,
  onSteer,
  threadKey,
}: {
  messages: QueuedMessage[]
  onEdit: (threadKey: string, queuedId: string) => void
  onRemove: (threadKey: string, queuedId: string) => void
  onSteer: (threadKey: string, queuedId: string) => void
  threadKey: string
}) {
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {messages.map((queued) => {
        const label =
          queued.text.trim() ||
          (queued.attachments.length
            ? `${queued.attachments.length} image${
                queued.attachments.length > 1 ? "s" : ""
              }`
            : "Queued message")
        return (
          <div
            key={queued.id}
            className="flex items-center gap-1.5 rounded-2xl border border-field/70 bg-background px-3 py-1.5"
          >
            <CornerDownRight className="size-4 shrink-0 text-muted-foreground/70" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {label}
            </span>
            <button
              type="button"
              onClick={() => onSteer(threadKey, queued.id)}
              title="Interrupt the running task and send this now"
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <CornerDownRight className="size-3.5" />
              Steer
            </button>
            <IconButton
              onClick={() => onEdit(threadKey, queued.id)}
              aria-label="Edit queued message"
              title="Edit"
            >
              <Pencil className="size-4" />
            </IconButton>
            <IconButton
              onClick={() => onRemove(threadKey, queued.id)}
              aria-label="Delete queued message"
              title="Delete"
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        )
      })}
    </div>
  )
}
