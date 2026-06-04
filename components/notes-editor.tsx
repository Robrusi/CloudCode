"use client"

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"

import { MarkdownEditor } from "@/components/markdown-editor"
import { useImageUpload } from "@/hooks/use-image-upload"
import { cn } from "@/lib/utils"

const SAVE_DELAY_MS = 600

export function NotesEditor({
  notes,
  notesThreadId,
  onSave,
  bare = false,
  toolbarPlacement = "bottom",
  toolbarClassName,
  toolbarTrailing,
  contentClassName,
}: {
  notes: string
  notesThreadId: string | null
  onSave: (markdown: string) => void
  /** Drop the card "well" chrome — fills the area like an open file. */
  bare?: boolean
  toolbarPlacement?: "top" | "bottom"
  toolbarClassName?: string
  toolbarTrailing?: ReactNode
  contentClassName?: string
}) {
  const uploadImage = useImageUpload()
  const [draft, setDraft] = useState(notes)
  const draftRef = useRef(draft)
  const savedRef = useRef(notes)
  const prevThreadRef = useRef(notesThreadId)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  draftRef.current = draft

  // Adopt the server value on thread switch (always) or a reactive update with
  // no unsaved local edits — never clobber in-progress typing.
  useEffect(() => {
    const threadChanged = prevThreadRef.current !== notesThreadId
    prevThreadRef.current = notesThreadId
    setDraft((current) => {
      if (threadChanged || current === savedRef.current) {
        savedRef.current = notes
        return notes
      }
      return current
    })
  }, [notes, notesThreadId])

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const md = draftRef.current
    if (md === savedRef.current) return
    savedRef.current = md
    onSave(md)
  }, [onSave])

  const handleChange = useCallback(
    (md: string) => {
      setDraft(md)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (md === savedRef.current) return
        savedRef.current = md
        onSave(md)
      }, SAVE_DELAY_MS)
    },
    [onSave]
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <MarkdownEditor
      value={draft}
      onChange={handleChange}
      onBlur={flush}
      onUploadImage={uploadImage}
      enableImages
      toolbarPlacement={toolbarPlacement}
      toolbarClassName={toolbarClassName}
      toolbarTrailing={toolbarTrailing}
      ariaLabel="Note"
      placeholder="Add notes, to-dos and lists…"
      className={cn(
        "min-h-0 flex-1",
        bare
          ? ""
          : "overflow-hidden rounded-xl border border-border/60 bg-muted/30 transition-colors focus-within:border-border focus-within:bg-muted/40"
      )}
      contentClassName={contentClassName ?? "min-h-0 flex-1"}
    />
  )
}
