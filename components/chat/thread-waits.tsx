"use client"

import { useQuery } from "convex/react"
import { Hourglass } from "lucide-react"

import { formatRelative } from "@/components/chat/format"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

type ThreadWait = {
  events: string[]
  expiresAt: number
  note?: string
  prNumber?: number
  provider: "slack" | "github" | "linear"
  status: string
  waitId: string
}

function waitLabel(wait: ThreadWait) {
  const note = wait.note ? ` — ${wait.note}` : ""
  if (wait.provider === "github") {
    return `Waiting on PR #${wait.prNumber} (${wait.events.join(", ")})${note}`
  }
  if (wait.provider === "linear") {
    return `Waiting on a Linear comment${note}`
  }
  if (wait.status === "arming") return `Asking in Slack${note}`
  const events = wait.events.length === 1 ? wait.events[0] : "reply or reaction"
  return `Waiting on a Slack ${events}${note}`
}

/** The agent's active waits on external events (Slack replies, PR activity,
 * Linear comments), rendered at the end of the thread like queued messages:
 * the thread is not done, it is parked until an event or timeout wakes it. */
export function ThreadWaits({ threadId }: { threadId: Id<"threads"> | null }) {
  const waits = useQuery(
    api.factoryWaits.listThreadWaits,
    threadId ? { threadId } : "skip"
  )
  if (!waits?.length) return null
  const now = Date.now()

  return (
    <div className="space-y-2">
      {waits.map((wait) => (
        <div
          key={wait.waitId}
          className="flex items-center gap-1.5 rounded-2xl border border-field/70 bg-background px-3 py-1.5"
        >
          <Hourglass className="size-4 shrink-0 text-muted-foreground/70" />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {waitLabel(wait)}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            expires {formatRelative(wait.expiresAt, now)}
          </span>
        </div>
      ))}
    </div>
  )
}
