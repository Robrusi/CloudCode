"use client"

import { X } from "lucide-react"
import { useMemo } from "react"

import { DiffList } from "@/components/diff/changed-files"
import { NotesEditor } from "@/components/markdown/notes-editor"
import { IconButton as UiIconButton } from "@/components/ui/icon-button"
export function AllDiffsPanel({
  diff,
  diffStyle,
  onClose,
}: {
  diff: string
  diffStyle: "unified" | "split"
  onClose: () => void
}) {
  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl">
        <span className="flex-1 text-[13px] text-muted-foreground">Diffs</span>
        <UiIconButton
          onClick={onClose}
          aria-label="Close diffs"
          className="-mr-[7px]"
        >
          <X />
        </UiIconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {diff ? (
          <DiffList diff={diff} diffStyle={diffStyle} />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            No diffs to show.
          </div>
        )}
      </div>
    </section>
  )
}

export function NotesPanel({
  notes,
  notesThreadId,
  onSave,
  onClose,
}: {
  notes: string
  notesThreadId: string | null
  onSave: (value: string) => void
  onClose: () => void
}) {
  const toolbarTrailing = useMemo(
    () => (
      <UiIconButton onClick={onClose} aria-label="Close notes">
        <X />
      </UiIconButton>
    ),
    [onClose]
  )

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <NotesEditor
        bare
        toolbarPlacement="top"
        toolbarClassName="h-[3.25rem] shrink-0 gap-0.5 bg-background/80 px-2.5 backdrop-blur-xl"
        toolbarTrailing={toolbarTrailing}
        notes={notes}
        notesThreadId={notesThreadId}
        onSave={onSave}
        contentClassName="min-h-0 flex-1 px-4 py-4"
      />
    </section>
  )
}
