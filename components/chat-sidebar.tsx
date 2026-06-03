"use client"

import { useClerk } from "@clerk/nextjs"
import {
  ChevronRight,
  Ellipsis,
  LaptopMinimal,
  Plus,
  Settings,
  SquarePen,
  User,
  X,
} from "lucide-react"
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react"

import { ContextMenu } from "@/components/context-menu"
import { ResizeHandle } from "@/components/resize-handle"
import type { Id } from "@/convex/_generated/dataModel"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { cn } from "@/lib/utils"

type SandboxState = "running" | "stopped" | "deleted" | "error"

type SidebarChat = {
  id: Id<"threads">
  repoUrl: string
  title: string
  updatedAt: number
  lastUserMessageAt: number
  pending: boolean
  sandboxState?: SandboxState
}

function repoLabel(url: string) {
  if (!url) return "Untitled"
  return url
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
}

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function BrailleSpinner({ className }: { className?: string }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(
      () => setFrame((f) => (f + 1) % BRAILLE_FRAMES.length),
      80
    )
    return () => clearInterval(id)
  }, [])
  return (
    <span
      aria-label="Agent running"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center font-mono text-lg leading-none tabular-nums",
        className
      )}
    >
      {BRAILLE_FRAMES[frame]}
    </span>
  )
}

function SandboxDot({
  state,
  starting,
}: {
  state?: SandboxState
  starting?: boolean
}) {
  if (state === "deleted" || state === "error") return null
  const running = state === "running" || starting
  if (!running && state !== "stopped") return null
  return (
    <LaptopMinimal
      aria-label={running ? "Sandbox running" : "Sandbox paused"}
      className={cn(
        "size-4 shrink-0",
        running ? "text-success" : "text-muted-foreground/70"
      )}
    />
  )
}

function relativeTime(ts: number) {
  const diff = Math.max(0, Date.now() - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return sec <= 1 ? "just now" : `${sec} seconds ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return min === 1 ? "1 minute ago" : `${min} minutes ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return hr === 1 ? "1 hour ago" : `${hr} hours ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return day === 1 ? "1 day ago" : `${day} days ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return mo === 1 ? "1 month ago" : `${mo} months ago`
  const yr = Math.floor(day / 365)
  return yr === 1 ? "1 year ago" : `${yr} years ago`
}

export function Sidebar({
  chats,
  activeId,
  currentView,
  onNewChat,
  onNewChatInRepo,
  onSelect,
  onDelete,
  onRename,
  onShowSettings,
  onClose,
  brandClassName,
}: {
  chats: SidebarChat[]
  activeId: Id<"threads"> | null
  currentView: "chat" | "settings"
  onNewChat: () => void
  onNewChatInRepo: (repoUrl: string) => void
  onSelect: (id: Id<"threads">) => void
  onDelete: (id: Id<"threads">) => void
  onRename: (id: Id<"threads">, title: string) => void
  onShowSettings: () => void
  onClose: () => void
  brandClassName: string
}) {
  const clerk = useClerk()
  const isMobile = useIsMobile()
  const { width, resizing, onResizeStart, resetWidth } = useResizablePanel({
    storageKey: "cloudcode:sidebarWidth",
    defaultWidth: 256,
    minWidth: 200,
    maxWidth: 480,
    edge: "right",
    enabled: !isMobile,
  })
  const groups = useMemo(() => {
    const map = new Map<string, SidebarChat[]>()
    for (const c of chats) {
      const key = c.repoUrl || ""
      const arr = map.get(key) ?? []
      arr.push(c)
      map.set(key, arr)
    }
    return Array.from(map.entries())
      .map(([repo, items]) => ({
        repo,
        items: items.sort((a, b) => b.lastUserMessageAt - a.lastUserMessageAt),
        latest: Math.max(...items.map((i) => i.lastUserMessageAt)),
      }))
      .sort((a, b) => b.latest - a.latest)
  }, [chats])

  return (
    <aside
      className="fixed inset-0 z-40 flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border/60 bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:relative md:inset-auto md:z-auto md:w-[var(--panel-width)] md:shrink-0 md:pt-0 md:pb-0"
      style={{ "--panel-width": `${width}px` } as CSSProperties}
    >
      <ResizeHandle
        edge="right"
        resizing={resizing}
        onResizeStart={onResizeStart}
        onReset={resetWidth}
        ariaLabel="Resize sidebar"
      />
      <div className="flex items-center justify-between px-[1.125rem] pt-6 pb-5">
        <span
          className={cn(
            brandClassName,
            "text-4xl tracking-tight text-foreground"
          )}
        >
          CloudCode
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sidebar"
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="px-2 pt-2">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-xl px-[0.625rem] py-2 text-[0.8125rem] text-foreground/80 transition-colors hover:bg-muted"
        >
          <SquarePen className="size-3 shrink-0" />
          <span>New chat</span>
        </button>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {groups.length === 0 ? (
          <div className="px-3 pt-4 text-[0.6875rem] text-muted-foreground/80">
            No chats yet
          </div>
        ) : (
          <div className="space-y-1">
            {groups.map((g) => (
              <FolderGroup
                key={g.repo || "untitled"}
                label={repoLabel(g.repo)}
                repoUrl={g.repo}
                items={g.items}
                activeId={activeId}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
                onNewChatInRepo={onNewChatInRepo}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border/60 p-3">
        <button
          type="button"
          onClick={onShowSettings}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[0.8125rem] transition-colors",
            currentView === "settings"
              ? "bg-muted text-foreground"
              : "text-foreground/80 hover:bg-muted"
          )}
        >
          <Settings className="size-3.5" />
          <span className="truncate">Settings</span>
        </button>
        <button
          type="button"
          onClick={() => clerk.openUserProfile()}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[0.8125rem] text-foreground/80 transition-colors hover:bg-muted"
        >
          <User className="size-3.5" />
          <span className="truncate">User</span>
        </button>
      </div>
    </aside>
  )
}

function FolderGroup({
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

  return (
    <div>
      <div className="group/folder flex w-full items-center gap-1 px-2.5 py-1.5 text-[0.8125rem] text-muted-foreground">
        <button
          type="button"
          onClick={() => setOpen(!open)}
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
      {open && (
        <div>
          {items.map((c) => (
            <SidebarItem
              key={c.id}
              chat={c}
              active={c.id === activeId}
              pending={c.pending}
              onSelect={() => onSelect(c.id)}
              onDelete={() => onDelete(c.id)}
              onRename={(title) => onRename(c.id, title)}
            />
          ))}
        </div>
      )}
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
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
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
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit(e.currentTarget.value)
            } else if (e.key === "Escape") {
              e.preventDefault()
              setEditing(false)
            }
          }}
          onClick={(e) => e.stopPropagation()}
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
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
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
