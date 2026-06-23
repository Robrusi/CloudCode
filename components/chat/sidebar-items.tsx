"use client"

import { ChevronRight, Ellipsis, Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { ContextMenu } from "@/components/ui/context-menu"
import type { SidebarChat } from "@/components/chat/sidebar-model"
import {
  isSidebarChatRunning,
  relativeTime,
} from "@/components/chat/sidebar-model"
import { BrailleSpinner, SandboxDot } from "@/components/chat/sidebar-status"
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/shared/utils"

const THREAD_PREVIEW_COUNT = 6

export function FolderGroup({
  label,
  repoUrl,
  items,
  activeId,
  onSelect,
  onDelete,
  onRename,
  onNewChatInRepo,
}: {
  label: string
  repoUrl: string
  items: SidebarChat[]
  activeId: Id<"threads"> | null
  onSelect: (id: Id<"threads">) => void
  onDelete: (id: Id<"threads">) => void
  onRename: (id: Id<"threads">, title: string) => void
  onNewChatInRepo: (repoUrl: string) => void
}) {
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const visibleItems = open ? items : items.filter(isSidebarChatRunning)
  const canExpand = open && visibleItems.length > THREAD_PREVIEW_COUNT
  const displayedItems =
    canExpand && !expanded
      ? visibleItems.slice(0, THREAD_PREVIEW_COUNT)
      : visibleItems

  return (
    <div>
      <div className="group/folder flex w-full items-center gap-1 px-2.5 py-1.5 text-[0.8125rem] text-muted-foreground">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform",
              open && "rotate-90"
            )}
          />
          <span className="flex-1 truncate">{label}</span>
        </button>
        <button
          type="button"
          onClick={() => onNewChatInRepo(repoUrl)}
          aria-label={`New chat in ${label}`}
          className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3" />
        </button>
      </div>
      {displayedItems.length > 0 ? (
        <div>
          {displayedItems.map((chat) => (
            <SidebarItem
              key={chat.id}
              chat={chat}
              active={chat.id === activeId}
              pending={chat.pending}
              onSelect={() => onSelect(chat.id)}
              onDelete={() => onDelete(chat.id)}
              onRename={(title) => onRename(chat.id, title)}
            />
          ))}
        </div>
      ) : null}
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[0.75rem] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          {expanded
            ? "Show less"
            : `Show ${visibleItems.length - THREAD_PREVIEW_COUNT} more`}
        </button>
      ) : null}
    </div>
  )
}

function SidebarItem({
  chat,
  active,
  pending,
  onSelect,
  onDelete,
  onRename,
}: {
  chat: SidebarChat
  active: boolean
  pending: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chat.title || "")
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  function startRename() {
    setDraft(chat.title || "")
    setEditing(true)
    setMenu(null)
  }

  function commit(value: string) {
    const next = value.trim()
    if (next && next !== chat.title) onRename(next)
    setEditing(false)
  }

  return (
    <div
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
      className={cn(
        "group/item relative flex items-center rounded-lg transition-colors",
        active ? "bg-muted" : "hover:bg-muted/60"
      )}
    >
      {editing ? (
        <input
          ref={inputRef}
          aria-label="Chat title"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commit(event.currentTarget.value)
            } else if (event.key === "Escape") {
              event.preventDefault()
              setEditing(false)
            }
          }}
          onClick={(event) => event.stopPropagation()}
          className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1 text-[0.8125rem] text-foreground ring-1 ring-border outline-none focus:ring-foreground/40"
        />
      ) : (
        <>
          <button
            type="button"
            onClick={onSelect}
            className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-1 pl-2.5 text-left md:pr-2.5"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="min-w-0 truncate text-[0.8125rem] text-foreground">
                {chat.title || "Untitled"}
              </span>
              <span className="min-w-0 truncate text-[0.6875rem] text-muted-foreground">
                {relativeTime(chat.lastUserMessageAt)}
              </span>
            </div>
            <span className="flex size-5 shrink-0 items-center justify-center">
              {pending ? (
                <BrailleSpinner className="text-muted-foreground" />
              ) : (
                <SandboxDot state={chat.sandboxState} starting={false} />
              )}
            </span>
          </button>
          <button
            type="button"
            aria-label="Chat options"
            onClick={(event) => {
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              const menuWidth = 180
              const menuHeight = 96
              setMenu({
                x: Math.max(
                  8,
                  Math.min(rect.right, window.innerWidth - 8) - menuWidth
                ),
                y: Math.min(rect.bottom + 4, window.innerHeight - menuHeight),
              })
            }}
            className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
          >
            <Ellipsis className="size-4" />
          </button>
        </>
      )}

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Rename", onSelect: startRename },
            { label: "Delete", onSelect: onDelete, destructive: true },
          ]}
        />
      ) : null}
    </div>
  )
}
