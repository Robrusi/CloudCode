"use client"

import { ImagePlus, Loader2, X } from "lucide-react"
import NextImage from "next/image"

import type { DraftImageAttachment } from "@/components/chat/types"

export function DraftAttachmentList({
  attachments,
  onRemove,
}: {
  attachments: DraftImageAttachment[]
  onRemove: (attachmentId: string) => void
}) {
  if (attachments.length === 0) return null

  return (
    <div className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1 md:px-4">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border/70 bg-muted"
          title={attachment.name}
        >
          {attachment.objectUrl || attachment.url ? (
            <NextImage
              src={(attachment.objectUrl ?? attachment.url)!}
              alt={attachment.name}
              fill
              unoptimized
              sizes="64px"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center">
              <ImagePlus className="size-5 text-muted-foreground" />
            </div>
          )}
          {attachment.status === "uploading" ? (
            <div className="absolute inset-0 grid place-items-center bg-background/65">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : null}
          {attachment.status === "failed" ? (
            <div className="text-destructive-foreground absolute inset-0 grid place-items-center bg-destructive/85 px-1 text-center text-[10px] leading-3">
              Failed
            </div>
          ) : null}
          <button
            type="button"
            aria-label={`Remove ${attachment.name}`}
            title="Remove image"
            onClick={() => onRemove(attachment.id)}
            className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-background/90 text-foreground opacity-100 shadow-sm md:opacity-0 md:transition-opacity md:group-hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
