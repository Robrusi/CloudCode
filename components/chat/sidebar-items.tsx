"use client"

import { ChevronRight, Clock, Ellipsis, Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { ContextMenu } from "@/components/ui/context-menu"
import type {
  SidebarChat,
  SidebarChatNode,
} from "@/components/chat/sidebar-model"
import {
  isSidebarNodeRunning,
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
  expanded,
  filterKey = "",
  open,
  subtreeOpen,
  onExpandedChange,
  onOpenChange,
  onSubtreeOpenChange,
  onSelect,
  onDelete,
  onRename,
  onNewChatInRepo,
}: {
  label: string
  repoUrl: string
  items: SidebarChatNode[]
  activeId: Id<"threads"> | null
  /** Persistent collapse/preview state is owned by the sidebar (see
   * useSidebarFolderState) so it survives this group unmounting while a
   * filter temporarily removes its repo. */
  expanded: boolean
  /** Identity of the active search/filter pass, "" while inactive (see
   * sidebarThreadFilterKey). While non-empty the preview cap lifts so every
   * match stays visible. */
  filterKey?: string
  open: boolean
  /** Sidebar-owned factory-subtree expansion, keyed by root thread id —
   * survives filtering unmounting the whole subtree. */
  subtreeOpen: (rootId: Id<"threads">) => boolean
  onExpandedChange: (expanded: boolean) => void
  onOpenChange: (open: boolean) => void
  onSubtreeOpenChange: (rootId: Id<"threads">, open: boolean) => void
  onSelect: (id: Id<"threads">) => void
  onDelete: (id: Id<"threads">) => void
  onRename: (id: Id<"threads">, title: string) => void
  onNewChatInRepo: (repoUrl: string) => void
}) {
  const showAll = filterKey !== ""
  // While a search/filter is active the group presents as open so its matches
  // show, via a transient override that leaves the persistent collapse state
  // untouched — clearing the filter restores exactly what the user had. The
  // override resets whenever the filter identity changes, so a new query
  // presents its matches even if the group was collapsed against the
  // previous one.
  const [filteredOpen, setFilteredOpen] = useState<boolean | null>(null)
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey)
    setFilteredOpen(null)
  }
  const effectiveOpen = showAll ? (filteredOpen ?? true) : open
  const toggleOpen = () => {
    if (showAll) setFilteredOpen(!effectiveOpen)
    else onOpenChange(!effectiveOpen)
  }
  const visibleItems = effectiveOpen
    ? items
    : items.filter(isSidebarNodeRunning)
  const canExpand =
    effectiveOpen && !showAll && visibleItems.length > THREAD_PREVIEW_COUNT
  const displayedItems =
    canExpand && !expanded
      ? visibleItems.slice(0, THREAD_PREVIEW_COUNT)
      : visibleItems

  return (
    <div>
      <div className="group/folder flex w-full items-center gap-1 px-2.5 py-1.5 text-[0.8125rem] text-muted-foreground">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={effectiveOpen}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform",
              effectiveOpen && "rotate-90"
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
          {displayedItems.map((node) => (
            <SidebarItem
              key={node.chat.id}
              chat={node.chat}
              childChats={node.children}
              active={node.chat.id === activeId}
              activeId={activeId}
              childrenOpen={subtreeOpen(node.chat.id)}
              filterKey={filterKey}
              pending={node.chat.pending}
              onChildrenOpenChange={(open) =>
                onSubtreeOpenChange(node.chat.id, open)
              }
              onSelect={() => onSelect(node.chat.id)}
              onDelete={() => onDelete(node.chat.id)}
              onRename={(title) => onRename(node.chat.id, title)}
              onSelectId={onSelect}
              onDeleteId={onDelete}
              onRenameId={onRename}
            />
          ))}
        </div>
      ) : null}
      {canExpand ? (
        <button
          type="button"
          onClick={() => onExpandedChange(!expanded)}
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

export function SidebarItem({
  chat,
  active,
  pending,
  childrenOpen: childrenOpenProp,
  filterKey = "",
  nested = false,
  showAutomationGlyph = true,
  childChats,
  activeId,
  onChildrenOpenChange,
  onSelect,
  onDelete,
  onRename,
  onSelectId,
  onDeleteId,
  onRenameId,
}: {
  chat: SidebarChat
  active: boolean
  pending: boolean
  /** Controlled subtree expansion (see useSidebarFolderState) so the state
   * survives this item unmounting while filtered away. Lists that never
   * filter rows out (automations) omit it and fall back to local state. */
  childrenOpen?: boolean
  /** Identity of the active search/filter pass, "" while inactive. While
   * non-empty a collapsed dispatch subtree presents as open, so the child
   * that caused the subtree to match is visible. */
  filterKey?: string
  nested?: boolean
  /** Rows already listed under an automation header skip the Clock glyph. */
  showAutomationGlyph?: boolean
  childChats?: SidebarChat[]
  activeId?: Id<"threads"> | null
  onChildrenOpenChange?: (open: boolean) => void
  onSelect: () => void
  onDelete: () => void
  onRename: (title: string) => void
  onSelectId?: (id: Id<"threads">) => void
  onDeleteId?: (id: Id<"threads">) => void
  onRenameId?: (id: Id<"threads">, title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chat.title || "")
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [localChildrenOpen, setLocalChildrenOpen] = useState(true)
  const childrenOpen = childrenOpenProp ?? localChildrenOpen
  const setChildrenOpen = onChildrenOpenChange ?? setLocalChildrenOpen
  const revealChildren = filterKey !== ""
  // Same transient pattern as FolderGroup: the override presents the subtree
  // open while filters are active, resets whenever the filter identity
  // changes, and leaves the persistent childrenOpen state to restore
  // afterwards.
  const [filteredChildrenOpen, setFilteredChildrenOpen] = useState<
    boolean | null
  >(null)
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey)
    setFilteredChildrenOpen(null)
  }
  const effectiveChildrenOpen = revealChildren
    ? (filteredChildrenOpen ?? true)
    : childrenOpen
  const toggleChildren = () => {
    if (revealChildren) setFilteredChildrenOpen(!effectiveChildrenOpen)
    else setChildrenOpen(!effectiveChildrenOpen)
  }
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)
  const hasChildren = Boolean(childChats?.length)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  function startRename() {
    setDraft(chat.title || "")
    setEditing(true)
    cancelledRef.current = false
    setMenu(null)
  }

  function commit(value: string) {
    // Escape cancels; a blur fired while the input unmounts must not re-commit.
    if (cancelledRef.current) {
      setEditing(false)
      return
    }
    const next = value.trim()
    if (next && next !== chat.title) onRename(next)
    setEditing(false)
  }

  return (
    <div>
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
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 pr-1 pl-2.5 md:pr-2.5",
              nested ? "py-1.5" : "py-2"
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                {showAutomationGlyph && chat.automationId ? (
                  <Clock
                    aria-label="Automation"
                    className="size-3 shrink-0 text-muted-foreground"
                  />
                ) : null}
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
                      cancelledRef.current = true
                      setEditing(false)
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className={cn(
                    "-my-px min-w-0 flex-1 rounded-[0.3125rem] border border-border bg-background px-1 py-px text-foreground outline-none focus:border-foreground/40",
                    nested ? "text-[0.75rem]" : "text-[0.8125rem]"
                  )}
                />
              </span>
              <span
                className={cn(
                  "min-w-0 truncate pl-1 text-muted-foreground",
                  nested ? "text-[0.625rem]" : "text-[0.6875rem]"
                )}
              >
                {relativeTime(chat.lastUserMessageAt)}
              </span>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onSelect}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 pr-1 pl-2.5 text-left md:pr-2.5",
                nested ? "py-1.5" : "py-2"
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  {showAutomationGlyph && chat.automationId ? (
                    <Clock
                      aria-label="Automation"
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                  ) : null}
                  <span
                    className={cn(
                      "min-w-0 truncate text-foreground",
                      nested ? "text-[0.75rem]" : "text-[0.8125rem]"
                    )}
                  >
                    {chat.title || "Untitled"}
                  </span>
                </span>
                <span
                  className={cn(
                    "min-w-0 truncate text-muted-foreground",
                    nested ? "text-[0.625rem]" : "text-[0.6875rem]"
                  )}
                >
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
            {hasChildren ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  toggleChildren()
                }}
                aria-expanded={effectiveChildrenOpen}
                aria-label={
                  effectiveChildrenOpen
                    ? "Collapse dispatched chats"
                    : "Expand dispatched chats"
                }
                className="mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform",
                    effectiveChildrenOpen && "rotate-90"
                  )}
                />
              </button>
            ) : null}
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
      {hasChildren && effectiveChildrenOpen ? (
        <div className="ml-4">
          {childChats?.map((child) => (
            <SidebarItem
              key={child.id}
              nested
              chat={child}
              active={child.id === activeId}
              pending={child.pending}
              onSelect={() => onSelectId?.(child.id)}
              onDelete={() => onDeleteId?.(child.id)}
              onRename={(title) => onRenameId?.(child.id, title)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
