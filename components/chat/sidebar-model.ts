import type { Id } from "@/convex/_generated/dataModel"
import { repoLabel } from "@/components/chat/format"
import type { SandboxState } from "@/components/chat/sandbox-types"

export type SidebarChat = {
  automationId?: Id<"automations">
  reviewId?: Id<"reviews">
  createdAt: number
  factoryRootThreadId?: Id<"threads">
  id: Id<"threads">
  lastUserMessageAt: number
  pending: boolean
  repoUrl: string
  sandboxState?: SandboxState
  title: string
  updatedAt: number
}

export type SidebarThreadSort = "activity" | "created" | "oldest" | "title"

export type SidebarThreadFilter = "all" | "running" | "sandbox"

export type SidebarThreadListOptions = {
  filter: SidebarThreadFilter
  query: string
  sort: SidebarThreadSort
}

export const DEFAULT_SIDEBAR_THREAD_OPTIONS: SidebarThreadListOptions = {
  filter: "all",
  query: "",
  sort: "activity",
}

export function hasActiveSidebarThreadFilters(
  options: Pick<SidebarThreadListOptions, "filter" | "query">
) {
  return options.filter !== "all" || options.query.trim().length > 0
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

export function nodeHasLiveSandbox(node: SidebarChatNode) {
  return (
    node.chat.sandboxState === "running" ||
    node.children.some((child) => child.sandboxState === "running")
  )
}

function sidebarQueryTokens(query: string) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function chatMatchesTokens(chat: SidebarChat, tokens: string[]) {
  const haystack =
    `${chat.title || "Untitled"} ${repoLabel(chat.repoUrl)}`.toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}

/** Nodes pass a filter as whole subtrees: a match on the root or on any
 * dispatched child keeps the node, so a hit never loses its dispatch
 * context.
 *
 * Search deliberately covers only the loaded sidebar feed — the newest
 * THREAD_LIST_LIMIT threads served by convex/chats.ts. It narrows the
 * visible list; querying full thread history would be a server-side search
 * feature with its own index and UX. */
export function filterSidebarChatNodes(
  nodes: SidebarChatNode[],
  options: Pick<SidebarThreadListOptions, "filter" | "query">
): SidebarChatNode[] {
  const tokens = sidebarQueryTokens(options.query)
  return nodes.filter((node) => {
    if (options.filter === "running" && !isSidebarNodeRunning(node)) {
      return false
    }
    if (options.filter === "sandbox" && !nodeHasLiveSandbox(node)) return false
    if (tokens.length === 0) return true
    return (
      chatMatchesTokens(node.chat, tokens) ||
      node.children.some((child) => chatMatchesTokens(child, tokens))
    )
  })
}

function nodeTitle(node: SidebarChatNode) {
  return node.chat.title || "Untitled"
}

export function sortSidebarChatNodes(
  nodes: SidebarChatNode[],
  sort: SidebarThreadSort
): SidebarChatNode[] {
  const sorted = [...nodes]
  switch (sort) {
    case "created":
      sorted.sort((a, b) => b.chat.createdAt - a.chat.createdAt)
      break
    case "oldest":
      sorted.sort((a, b) => a.latest - b.latest)
      break
    case "title":
      sorted.sort(
        (a, b) =>
          nodeTitle(a).localeCompare(nodeTitle(b), undefined, {
            sensitivity: "base",
          }) || b.latest - a.latest
      )
      break
    default:
      sorted.sort((a, b) => b.latest - a.latest)
  }
  return sorted
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

export function groupSidebarChats(
  chats: SidebarChat[],
  options: SidebarThreadListOptions = DEFAULT_SIDEBAR_THREAD_OPTIONS
): SidebarChatGroup[] {
  const nodes = sortSidebarChatNodes(
    filterSidebarChatNodes(buildSidebarChatNodes(chats), options),
    options.sort
  )
  // Nodes arrive pre-sorted, so pushes keep group items ordered and map
  // insertion order ranks groups by their best-ranked node.
  const map = new Map<string, SidebarChatGroup>()
  for (const node of nodes) {
    const key = node.chat.repoUrl || ""
    const group = map.get(key)
    if (group) {
      group.items.push(node)
      group.latest = Math.max(group.latest, node.latest)
    } else {
      map.set(key, {
        items: [node],
        latest: node.latest,
        repo: key,
      })
    }
  }
  const groups = Array.from(map.values())
  // Title sort lists folders alphabetically; every other sort keeps folders
  // ranked by their best node via insertion order.
  if (options.sort === "title") {
    groups.sort((a, b) =>
      repoLabel(a.repo).localeCompare(repoLabel(b.repo), undefined, {
        sensitivity: "base",
      })
    )
  }
  return groups
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
