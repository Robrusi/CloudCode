"use client"

import { useClerk } from "@clerk/nextjs"
import {
  ChevronRight,
  Folder,
  Settings,
  SquarePen,
  User,
} from "lucide-react"
import { useMemo, useState } from "react"

import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"

type SidebarChat = {
  id: Id<"threads">
  repoUrl: string
  title: string
  updatedAt: number
}

function repoLabel(url: string) {
  if (!url) return "Untitled"
  return url
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
}

export function Sidebar({
  chats,
  activeId,
  currentView,
  onNewChat,
  onSelect,
  onDelete,
  onRename,
  onShowSettings,
  brandClassName,
}: {
  chats: SidebarChat[]
  activeId: Id<"threads"> | null
  currentView: "chat" | "settings"
  onNewChat: () => void
  onSelect: (id: Id<"threads">) => void
  onDelete: (id: Id<"threads">) => void
  onRename: (id: Id<"threads">, title: string) => void
  onShowSettings: () => void
  brandClassName: string
}) {
  const clerk = useClerk()
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
        items: items.sort((a, b) => b.updatedAt - a.updatedAt),
        latest: Math.max(...items.map((i) => i.updatedAt)),
      }))
      .sort((a, b) => b.latest - a.latest)
  }, [chats])

  return (
    <aside className="flex h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden border-r border-border/60 bg-sidebar text-sidebar-foreground">
      <div className="px-[1.125rem] pt-6 pb-5">
        <span
          className={cn(
            brandClassName,
            "text-4xl tracking-tight text-foreground"
          )}
        >
          CloudCode
        </span>
      </div>
      <div className="px-2 pt-2">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-xl px-[0.625rem] py-2 text-sm text-foreground/80 transition-colors hover:bg-muted"
        >
          <SquarePen className="size-3.5 shrink-0" />
          <span>New chat</span>
        </button>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {groups.length === 0 ? (
          <div className="px-3 pt-4 text-xs text-muted-foreground/80">
            No chats yet
          </div>
        ) : (
          <div className="space-y-1">
            {groups.map((g) => (
              <FolderGroup
                key={g.repo || "untitled"}
                label={repoLabel(g.repo)}
                items={g.items}
                activeId={activeId}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
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
            "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition-colors",
            currentView === "settings"
              ? "bg-muted text-foreground"
              : "text-foreground/80 hover:bg-muted"
          )}
        >
          <Settings className="size-4" />
          <span className="truncate">Settings</span>
        </button>
        <button
          type="button"
          onClick={() => clerk.openUserProfile()}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted"
        >
          <User className="size-4" />
          <span className="truncate">User</span>
        </button>
      </div>
    </aside>
  )
}

function FolderGroup({
  label,
  items,
  activeId,
  onSelect,
  onDelete,
  onRename,
}: {
  label: string
  items: SidebarChat[]
  activeId: Id<"threads"> | null
  onSelect: (id: Id<"threads">) => void
  onDelete: (id: Id<"threads">) => void
  onRename: (id: Id<"threads">, title: string) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Folder className="size-3.5 shrink-0" />
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90"
          )}
        />
      </button>
      {open && (
        <div>
          {items.map((c) => (
            <SidebarItem
              key={c.id}
              chat={c}
              active={c.id === activeId}
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
  onSelect,
  onDelete,
  onRename,
}: {
  chat: SidebarChat
  active: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chat.title || "")
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

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
        "group/item relative flex items-center rounded-lg pr-1 transition-colors",
        active ? "bg-muted" : "hover:bg-muted/60"
      )}
    >
      {editing ? (
        <input
          autoFocus
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
          className="min-w-0 flex-1 truncate rounded-md bg-background px-2 py-1 text-sm text-foreground ring-1 ring-border outline-none focus:ring-foreground/40"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm text-foreground/85"
        >
          <span className="min-w-0 flex-1 truncate">
            {chat.title || "Untitled"}
          </span>
        </button>
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

function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: { label: string; onSelect: () => void; destructive?: boolean }[]
  onClose: () => void
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        role="menu"
        style={{ top: y, left: x }}
        className="fixed z-50 min-w-44 overflow-hidden rounded-2xl border border-black/[0.06] bg-popover p-1.5 text-popover-foreground shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] dark:border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              item.onSelect()
              onClose()
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted",
              item.destructive &&
                "text-destructive hover:bg-destructive/10 hover:text-destructive"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}
