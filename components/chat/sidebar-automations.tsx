"use client"

import { useQuery } from "convex/react"
import { ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import {
  automationLastRunPhrase,
  automationStatusDotClass,
  automationTriggerLabel,
  type AutomationRecord,
} from "@/components/automations/model"
import { SidebarItem } from "@/components/chat/sidebar-items"
import {
  buildSidebarChatNodes,
  type SidebarChat,
  type SidebarChatNode,
} from "@/components/chat/sidebar-model"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/shared/utils"

type AutomationGroup = {
  automation: AutomationRecord
  latest: number
  nodes: SidebarChatNode[]
}

/** Automations-context sidebar: one row per automation sorted by most recent
 * activity, expandable to its run threads. Replaces the repo folders used by
 * the chats context. */
export function SidebarAutomationList({
  chats,
  activeId,
  onSelect,
  onDelete,
  onRename,
  onShowAutomations,
}: {
  chats: SidebarChat[]
  activeId: Id<"threads"> | null
  onSelect: (id: Id<"threads">) => void
  onDelete: (id: Id<"threads">) => void
  onRename: (id: Id<"threads">, title: string) => void
  onShowAutomations: () => void
}) {
  const automations = useQuery(api.automations.list)

  const grouped = useMemo(() => {
    if (!automations) return null
    const nodesByAutomation = new Map<string, SidebarChatNode[]>()
    const orphans: SidebarChatNode[] = []
    for (const node of buildSidebarChatNodes(chats)) {
      const key = node.chat.automationId as string | undefined
      if (!key) {
        orphans.push(node)
        continue
      }
      const list = nodesByAutomation.get(key)
      if (list) list.push(node)
      else nodesByAutomation.set(key, [node])
    }
    const groups: AutomationGroup[] = automations.map((automation) => {
      const key = automation._id as string
      const nodes = nodesByAutomation.get(key) ?? []
      nodesByAutomation.delete(key)
      const latest = nodes.reduce(
        (max, node) => Math.max(max, node.latest),
        automation.lastRunAt ?? automation.updatedAt
      )
      return { automation, latest, nodes }
    })
    groups.sort((a, b) => b.latest - a.latest)
    // Threads pointing at an automation missing from the list (e.g. one being
    // deleted right now) still render as plain rows below the groups.
    for (const nodes of nodesByAutomation.values()) orphans.push(...nodes)
    orphans.sort((a, b) => b.latest - a.latest)
    return { groups, orphans }
  }, [automations, chats])

  if (!grouped) {
    return (
      <div className="space-y-2 px-3 pt-4">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-3 w-40 animate-pulse rounded bg-muted/60"
          />
        ))}
      </div>
    )
  }
  if (grouped.groups.length === 0 && grouped.orphans.length === 0) {
    return (
      <div className="px-3 pt-4 text-[0.6875rem] text-muted-foreground/80">
        No automations yet
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {grouped.groups.map((group) => (
        <SidebarAutomationGroup
          key={group.automation._id}
          activeId={activeId}
          automation={group.automation}
          nodes={group.nodes}
          onDelete={onDelete}
          onRename={onRename}
          onSelect={onSelect}
          onShowAutomations={onShowAutomations}
        />
      ))}
      {grouped.orphans.map((node) => (
        <SidebarItem
          key={node.chat.id}
          chat={node.chat}
          childChats={node.children}
          active={node.chat.id === activeId}
          activeId={activeId}
          pending={node.chat.pending}
          onSelect={() => onSelect(node.chat.id)}
          onDelete={() => onDelete(node.chat.id)}
          onRename={(title) => onRename(node.chat.id, title)}
          onSelectId={onSelect}
          onDeleteId={onDelete}
          onRenameId={onRename}
        />
      ))}
    </div>
  )
}

function SidebarAutomationGroup({
  activeId,
  automation,
  nodes,
  onDelete,
  onRename,
  onSelect,
  onShowAutomations,
}: {
  activeId: Id<"threads"> | null
  automation: AutomationRecord
  nodes: SidebarChatNode[]
  onDelete: (id: Id<"threads">) => void
  onRename: (id: Id<"threads">, title: string) => void
  onSelect: (id: Id<"threads">) => void
  onShowAutomations: () => void
}) {
  const containsActive =
    activeId !== null &&
    nodes.some(
      (node) =>
        node.chat.id === activeId ||
        node.children.some((child) => child.id === activeId)
    )
  // null follows the active thread; a click on the chevron pins the state.
  const [openState, setOpenState] = useState<boolean | null>(null)
  const open = openState ?? containsActive
  const lastRun = automationLastRunPhrase(automation, Date.now())

  return (
    <div>
      <div className="group/automation relative flex items-center rounded-lg transition-colors hover:bg-muted/60">
        <button
          type="button"
          onClick={() =>
            nodes[0] ? onSelect(nodes[0].chat.id) : onShowAutomations()
          }
          title={nodes[0] ? "Open latest run chat" : "Open automations"}
          aria-label={automation.name}
          className="flex min-w-0 flex-1 items-start gap-2 py-2 pr-1 pl-2.5 text-left"
        >
          <span
            aria-hidden
            className={cn(
              "mt-[5px] size-1.5 shrink-0 rounded-full",
              automationStatusDotClass(automation)
            )}
          />
          <span
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-0.5",
              !automation.enabled && "opacity-60"
            )}
          >
            <span className="min-w-0 truncate text-[0.8125rem] text-foreground">
              {automation.name}
            </span>
            <span className="min-w-0 truncate text-[0.6875rem] text-muted-foreground">
              {automationTriggerLabel(automation)}
              {" · "}
              <span className={lastRun.failed ? "text-destructive" : undefined}>
                {lastRun.text}
              </span>
            </span>
          </span>
        </button>
        {nodes.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpenState(!open)}
            aria-expanded={open}
            aria-label={open ? "Collapse run chats" : "Expand run chats"}
            className="mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight
              className={cn("size-3 transition-transform", open && "rotate-90")}
            />
          </button>
        ) : null}
      </div>
      {open && nodes.length > 0 ? (
        <div className="ml-3">
          {nodes.map((node) => (
            <SidebarItem
              key={node.chat.id}
              chat={node.chat}
              childChats={node.children}
              active={node.chat.id === activeId}
              activeId={activeId}
              pending={node.chat.pending}
              showAutomationGlyph={false}
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
    </div>
  )
}
