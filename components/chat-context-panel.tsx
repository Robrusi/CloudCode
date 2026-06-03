"use client"

import { FileDiff, FolderGit2, GitBranch, X } from "lucide-react"
import { type CSSProperties, type ReactNode } from "react"

import { NotesEditor } from "@/components/notes-editor"
import { IconButton } from "@/components/ui/icon-button"
import { ResizeHandle } from "@/components/resize-handle"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { cn } from "@/lib/utils"

type ChatEnvironment = {
  additions: number
  baseBranch: string
  branch: string | null
  changedFileCount: number
  deletions: number
  repoName: string | null
}

export function ChatContextPanel({
  open,
  environment,
  notes,
  notesThreadId,
  onClose,
  onSaveNotes,
  onOpenChanges,
}: {
  open: boolean
  environment: ChatEnvironment
  notes: string
  notesThreadId: string | null
  onClose: () => void
  onSaveNotes: (notes: string) => void
  onOpenChanges: () => void
}) {
  const isMobile = useIsMobile()
  const { width, resizing, onResizeStart, resetWidth } = useResizablePanel({
    storageKey: "cloudcode:contextPanelWidth",
    defaultWidth: 304,
    minWidth: 240,
    maxWidth: 560,
    edge: "left",
    enabled: !isMobile,
  })

  if (!open) return null

  return (
    <aside
      className="fixed inset-0 z-40 flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border/60 bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:relative md:inset-auto md:z-auto md:w-[var(--panel-width)] md:shrink-0 md:pt-0 md:pb-0"
      style={{ "--panel-width": `${width}px` } as CSSProperties}
    >
      <ResizeHandle
        edge="left"
        resizing={resizing}
        onResizeStart={onResizeStart}
        onReset={resetWidth}
        ariaLabel="Resize context panel"
      />
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span className="text-sm font-medium text-foreground/85">Context</span>
        <IconButton
          onClick={onClose}
          aria-label="Close context panel"
          className="ml-auto"
        >
          <X />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-5">
        <div className="mb-6 space-y-2.5 px-1">
          <EnvRow
            icon={<FolderGit2 className="size-3.5" />}
            label="Repository"
            value={environment.repoName ?? "Not set"}
          />
          <EnvRow
            icon={<GitBranch className="size-3.5" />}
            label="Branch"
            value={environment.branch ?? (environment.baseBranch || "Default")}
          />
          <EnvRow
            icon={<FileDiff className="size-3.5" />}
            label="Changes"
            value={
              environment.changedFileCount > 0 ? (
                <button
                  type="button"
                  onClick={onOpenChanges}
                  className="rounded-sm text-foreground underline-offset-2 transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {environment.changedFileCount}{" "}
                  {environment.changedFileCount === 1 ? "file" : "files"}
                  <span aria-hidden className="text-muted-foreground/50">
                    {" · "}
                  </span>
                  <span className="text-success">+{environment.additions}</span>{" "}
                  <span className="text-destructive">
                    −{environment.deletions}
                  </span>
                </button>
              ) : (
                "No changes yet"
              )
            }
            muted={environment.changedFileCount === 0}
          />
        </div>

        <Section title="Notes" last>
          <NotesEditor
            notes={notes}
            notesThreadId={notesThreadId}
            onSave={onSaveNotes}
          />
        </Section>
      </div>
    </aside>
  )
}

function Section({
  title,
  last,
  children,
}: {
  title: string
  last?: boolean
  children: ReactNode
}) {
  return (
    <section className={cn(last ? "" : "mb-6")}>
      <h3 className="px-1 pb-2 text-[11px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function EnvRow({
  icon,
  label,
  value,
  muted,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  muted?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[11px] font-medium tracking-wide uppercase">
          {label}
        </span>
      </span>
      <span
        className={cn(
          "ml-auto min-w-0 truncate text-right text-[13px]",
          muted ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  )
}
