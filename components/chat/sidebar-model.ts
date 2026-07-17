import type { Id } from "@/convex/_generated/dataModel"
import type { SandboxState } from "@/components/chat/sandbox-types"

export type SidebarChat = {
  automationId?: Id<"automations">
  reviewId?: Id<"reviews">
  factoryRootThreadId?: Id<"threads">
  id: Id<"threads">
  lastUserMessageAt: number
  pending: boolean
  repoUrl: string
  sandboxState?: SandboxState
  title: string
  updatedAt: number
}

/** One sidebar row: a thread plus the factory-dispatched threads nested
 * under it. `latest` is the subtree's most recent activity, so a working
 * child keeps its root sorted to the top. */
export type SidebarChatNode = {
  chat: SidebarChat
  children: SidebarChat[]
  latest: number
}

export type SidebarChatGroup = {
  items: SidebarChatNode[]
  latest: number
  repo: string
}

export function isSidebarNodeRunning(node: SidebarChatNode) {
  return node.chat.pending || node.children.some((child) => child.pending)
}

/** One node per top-level thread with factory-dispatched children nested
 * under it, sorted by most recent subtree activity. */
export function buildSidebarChatNodes(chats: SidebarChat[]): SidebarChatNode[] {
  // Factory-dispatched threads nest under their root thread when it is in
  // the same list; a root that was deleted or filtered away leaves the child
  // rendered as a normal top-level chat.
  const ids = new Set(chats.map((chat) => chat.id as string))
  const childrenByRoot = new Map<string, SidebarChat[]>()
  const topLevel: SidebarChat[] = []
  for (const chat of chats) {
    const rootId = chat.factoryRootThreadId
    if (rootId && rootId !== chat.id && ids.has(rootId as string)) {
      const siblings = childrenByRoot.get(rootId as string)
      if (siblings) siblings.push(chat)
      else childrenByRoot.set(rootId as string, [chat])
    } else {
      topLevel.push(chat)
    }
  }

  const nodes = topLevel.map((chat) => {
    const children = (childrenByRoot.get(chat.id as string) ?? []).sort(
      (a, b) => b.lastUserMessageAt - a.lastUserMessageAt
    )
    const latest = children.reduce(
      (max, child) => Math.max(max, child.lastUserMessageAt),
      chat.lastUserMessageAt
    )
    return { chat, children, latest }
  })
  return nodes.sort((a, b) => b.latest - a.latest)
}

export function groupSidebarChats(chats: SidebarChat[]): SidebarChatGroup[] {
  // Nodes arrive newest-first, so pushes keep group items sorted and the
  // first node of a group carries its latest activity.
  const map = new Map<string, SidebarChatGroup>()
  for (const node of buildSidebarChatNodes(chats)) {
    const key = node.chat.repoUrl || ""
    const group = map.get(key)
    if (group) {
      group.items.push(node)
    } else {
      map.set(key, {
        items: [node],
        latest: node.latest,
        repo: key,
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.latest - a.latest)
}

export function relativeTime(timestamp: number) {
  const diff = Math.max(0, Date.now() - timestamp)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return seconds <= 1 ? "just now" : `${seconds} seconds ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return days === 1 ? "1 day ago" : `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`
  const years = Math.floor(days / 365)
  return years === 1 ? "1 year ago" : `${years} years ago`
}
