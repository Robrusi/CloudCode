"use client"

import { useEffect, useState } from "react"

import { useMutation, useQuery } from "convex/react"
import { Hourglass, Trash2 } from "lucide-react"

import { ComposerIconButton } from "@/components/chat/controls"
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
  waitId: Id<"factoryWaits">
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
 * Linear comments), rendered above the composer exactly like queued
 * messages: the thread is not done, it is parked until an event or timeout
 * wakes it. The trash button cancels a wait and leaves the thread parked. */
export function ThreadWaits({ threadId }: { threadId: Id<"threads"> | null }) {
  const waits = useQuery(
    api.factoryWaits.listThreadWaits,
    threadId ? { threadId } : "skip"
  )
  const cancelWait = useMutation(api.factoryWaits.userCancelWait)
  const [busyWaitIds, setBusyWaitIds] = useState<Set<string>>(new Set())
  // Waits are long-lived and the query only pushes updates when a wait
  // changes, so the expiry labels need their own clock to stay honest.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  if (!waits?.length) return null

  const onCancel = (waitId: Id<"factoryWaits">) => {
    setBusyWaitIds((prev) => new Set(prev).add(waitId))
    void cancelWait({ waitId })
      .catch(() => undefined)
      .finally(() => {
        setBusyWaitIds((prev) => {
          const next = new Set(prev)
          next.delete(waitId)
          return next
        })
      })
  }

  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {waits.map((wait) => {
        const label = waitLabel(wait)
        return (
          <div
            key={wait.waitId}
            className="flex items-center gap-1.5 rounded-2xl border border-field/70 bg-background px-3 py-1.5"
          >
            <Hourglass className="size-4 shrink-0 text-muted-foreground/70" />
            <span
              className="min-w-0 flex-1 truncate text-sm text-foreground"
              title={label}
            >
              {label}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              expires {formatRelative(wait.expiresAt, now)}
            </span>
            <ComposerIconButton
              onClick={() => onCancel(wait.waitId)}
              disabled={busyWaitIds.has(wait.waitId)}
              aria-label="Cancel wait"
              title="Stop waiting"
            >
              <Trash2 className="size-4" />
            </ComposerIconButton>
          </div>
        )
      })}
    </div>
  )
}
