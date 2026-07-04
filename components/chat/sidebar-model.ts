import type { Id } from "@/convex/_generated/dataModel"
import type { SandboxState } from "@/components/chat/sandbox-types"

// types
export type SidebarChat = {
  automationId?: Id<"automations">
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

export type WorkspaceHealthLevel = "active" | "idle" | "attention" | "empty"

export type WorkspaceHealthSummary = {
  attentionCount: number
  automationCount: number
  latestActivityAt: number | null
  level: WorkspaceHealthLevel
  pendingCount: number
  repoCount: number
  runningSandboxCount: number
  staleCount: number
  stoppedSandboxCount: number
  totalChats: number
}

const STALE_THREAD_AGE_MS = 1000 * 60 * 60 * 24 * 14

export function isSidebarChatRunning(chat: SidebarChat) {
  return chat.pending
}

export function summarizeWorkspaceHealth(
  chats: SidebarChat[],
  now = Date.now()
): WorkspaceHealthSummary {
  const repos = new Set<string>()
  let automationCount = 0
  let latestActivityAt: number | null = null
  let pendingCount = 0
  let runningSandboxCount = 0
  let staleCount = 0
  let stoppedSandboxCount = 0

  for (const chat of chats) {
    if (chat.repoUrl) repos.add(chat.repoUrl)
    if (chat.automationId) automationCount += 1
    if (chat.pending) pendingCount += 1
    if (chat.sandboxState === "running") runningSandboxCount += 1
    if (chat.sandboxState === "stopped") stoppedSandboxCount += 1
    if (now - chat.lastUserMessageAt >= STALE_THREAD_AGE_MS) staleCount += 1
    if (
      latestActivityAt === null ||
      chat.lastUserMessageAt > latestActivityAt
    ) {
      latestActivityAt = chat.lastUserMessageAt
    }
  }

  const attentionCount = chats.filter(
    (chat) => chat.pending || chat.sandboxState === "running"
  ).length
  const level: WorkspaceHealthLevel =
    chats.length === 0
      ? "empty"
      : attentionCount > 0
        ? "active"
        : stoppedSandboxCount > 0 || staleCount > 0
          ? "attention"
          : "idle"

  return {
    attentionCount,
    automationCount,
    latestActivityAt,
    level,
    pendingCount,
    repoCount: repos.size,
    runningSandboxCount,
    staleCount,
    stoppedSandboxCount,
    totalChats: chats.length,
  }
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

export function relativeTime(timestamp: number, now = Date.now()) {
  const diff = Math.max(0, now - timestamp)
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
