"use client"

import { Image as ImageIcon, Loader2, X } from "lucide-react"
import NextImage from "next/image"
import { useState } from "react"

import type { Block } from "@/components/markdown/editor-model"
import type { EditableMarkdownField } from "@/components/markdown/editor-types"
import { IconButton } from "@/components/ui/icon-button"

export function ImageRow({
  block,
  onConfirm,
  onFocus,
  onRemove,
  setRef,
}: {
  block: Block
  onConfirm: (url: string) => void
  onFocus: () => void
  onRemove: () => void
  setRef: (id: string) => (el: EditableMarkdownField | null) => void
}) {
  const [draft, setDraft] = useState(block.url ?? "")

  if (block.uploading) {
    return (
      <div className="flex items-center gap-2 py-1 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin" />
        Uploading image…
      </div>
    )
  }

  if (!block.url) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={setRef(block.id)}
          type="url"
          inputMode="url"
          aria-label="Image URL"
          value={draft}
          placeholder="Paste an image URL, then press Enter"
          onFocus={onFocus}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onConfirm(draft)
            } else if (event.key === "Escape") {
              event.preventDefault()
              onRemove()
            }
          }}
          onBlur={() => onConfirm(draft)}
          className="w-full bg-transparent text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/55"
        />
      </div>
    )
  }

  return (
    <div className="group/img relative w-fit max-w-full py-1">
      <NextImage
        src={block.url}
        alt={block.text}
        width={640}
        height={360}
        unoptimized
        className="max-h-72 w-auto max-w-full rounded-lg border border-border/60"
        style={{ height: "auto" }}
      />
      <IconButton
        size="xs"
        aria-label="Remove image"
        title="Remove image"
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 border border-border/60 bg-background/85 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/img:opacity-100"
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}
