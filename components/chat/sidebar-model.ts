import type { Id } from "@/convex/_generated/dataModel"
import type { SandboxState } from "@/components/chat/sandbox-types"

export type SidebarChat = {
  automationId?: Id<"automations">
  reviewId?: Id<"reviews">
  id: Id<"threads">
  lastUserMessageAt: number
  pending: boolean
  repoUrl: string
  sandboxState?: SandboxState
  title: string
  updatedAt: number
}

export type SidebarChatGroup = {
  items: SidebarChat[]
  latest: number
  repo: string
}

export function isSidebarChatRunning(chat: SidebarChat) {
  return chat.pending
}

export function groupSidebarChats(chats: SidebarChat[]): SidebarChatGroup[] {
  const map = new Map<string, SidebarChatGroup>()
  for (const chat of chats) {
    const key = chat.repoUrl || ""
    const group = map.get(key)
    if (group) {
      group.items.push(chat)
      if (chat.lastUserMessageAt > group.latest) {
        group.latest = chat.lastUserMessageAt
      }
    } else {
      map.set(key, {
        items: [chat],
        latest: chat.lastUserMessageAt,
        repo: key,
      })
    }
  }

  const groups = Array.from(map.values())
  for (const group of groups) {
    group.items.sort((a, b) => b.lastUserMessageAt - a.lastUserMessageAt)
  }
  return groups.sort((a, b) => b.latest - a.latest)
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
