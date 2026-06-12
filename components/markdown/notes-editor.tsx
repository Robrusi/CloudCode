"use client"

import {
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react"

import { MarkdownEditor } from "@/components/markdown/editor"
import { useImageUpload } from "@/hooks/use-image-upload"
import { cn } from "@/lib/shared/utils"

const SAVE_DELAY_MS = 600

type NotesEditorState = {
  draft: string
  saved: string
  threadId: string | null
}

type NotesEditorAction =
  | { type: "change"; draft: string }
  | { type: "mark-saved"; markdown: string }
  | { type: "sync"; notes: string; threadId: string | null }

function createNotesEditorState({
  notes,
  notesThreadId,
}: {
  notes: string
  notesThreadId: string | null
}): NotesEditorState {
  return {
    draft: notes,
    saved: notes,
    threadId: notesThreadId,
  }
}

function notesEditorReducer(
  state: NotesEditorState,
  action: NotesEditorAction
): NotesEditorState {
  switch (action.type) {
    case "change":
      return { ...state, draft: action.draft }
    case "mark-saved":
      return { ...state, saved: action.markdown }
    case "sync": {
      const threadChanged = state.threadId !== action.threadId
      if (threadChanged || state.draft === state.saved) {
        return {
          draft: action.notes,
          saved: action.notes,
          threadId: action.threadId,
        }
      }
      return { ...state, threadId: action.threadId }
    }
  }
}

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
  const [state, dispatch] = useReducer(
    notesEditorReducer,
    { notes, notesThreadId },
    createNotesEditorState
  )
  const draftRef = useRef(state.draft)
  const savedRef = useRef(state.saved)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  draftRef.current = state.draft
  savedRef.current = state.saved

  const clearSaveTimer = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  // Adopt the server value on thread switch (always) or a reactive update with
  // no unsaved local edits — never clobber in-progress typing.
  useEffect(() => {
    dispatch({ type: "sync", notes, threadId: notesThreadId })
  }, [notes, notesThreadId])

  const flush = useCallback(() => {
    clearSaveTimer()
    const md = draftRef.current
    if (md === savedRef.current) return
    dispatch({ type: "mark-saved", markdown: md })
    onSave(md)
  }, [clearSaveTimer, onSave])

  const handleChange = useCallback(
    (md: string) => {
      dispatch({ type: "change", draft: md })
      clearSaveTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (md === savedRef.current) return
        dispatch({ type: "mark-saved", markdown: md })
        onSave(md)
      }, SAVE_DELAY_MS)
    },
    [clearSaveTimer, onSave]
  )

  useEffect(() => clearSaveTimer, [clearSaveTimer])

  return (
    <MarkdownEditor
      value={state.draft}
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
