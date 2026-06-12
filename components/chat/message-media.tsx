"use client"

import NextImage from "next/image"
import { useEffect, useMemo, useState } from "react"

import { Markdown } from "@/components/chat/markdown"
import {
  imageAttachmentLayout,
  type ChatMessage,
} from "@/components/chat/message-model"
import { splitTextWithRecordings } from "@/components/chat/message-segments"
import { RecordingVideo } from "@/components/sandbox/recording-video"

export function ImageAttachmentPreview({
  attachment,
  compact,
}: {
  attachment: NonNullable<ChatMessage["attachments"]>[number]
  compact: boolean
}) {
  const [dimensions, setDimensions] = useState<{
    height: number
    width: number
  } | null>(null)

  useEffect(() => {
    let canceled = false
    const image = new window.Image()
    image.onload = () => {
      if (canceled) return
      setDimensions({
        height: image.naturalHeight || 1,
        width: image.naturalWidth || 1,
      })
    }
    image.onerror = () => {
      if (!canceled) setDimensions(null)
    }
    image.src = attachment.url

    return () => {
      canceled = true
      image.onload = null
      image.onerror = null
    }
  }, [attachment.url])

  const layout = useMemo(
    () => imageAttachmentLayout(dimensions, compact),
    [compact, dimensions]
  )

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="relative block max-w-full overflow-hidden rounded-xl border border-border/60 bg-background/70"
      style={layout}
      title={attachment.name}
    >
      <NextImage
        src={attachment.url}
        alt={attachment.name}
        fill
        unoptimized
        sizes={compact ? "180px" : "(max-width: 768px) 85vw, 560px"}
        className="object-contain"
      />
    </a>
  )
}

export function MarkdownWithRecordingVideos({
  className,
  onOpenFile,
  repoName,
  sandboxId,
  text,
}: {
  className?: string
  onOpenFile: (path: string) => void
  repoName: string | null
  sandboxId?: string | null
  text: string
}) {
  const parts = useMemo(
    () => splitTextWithRecordings(text, sandboxId),
    [sandboxId, text]
  )

  return (
    <div className="space-y-3">
      {parts.map((part) =>
        part.kind === "recording" ? (
          <RecordingVideo key={part.key} recording={part.recording} />
        ) : (
          <Markdown
            key={part.key}
            text={part.text}
            className={className}
            repoName={repoName}
            onOpenFile={onOpenFile}
          />
        )
      )}
    </div>
  )
}
