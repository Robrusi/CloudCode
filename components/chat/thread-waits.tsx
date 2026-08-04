"use client"

import { useEffect, useState } from "react"

import { useAction, useMutation, useQuery } from "convex/react"
import { Hourglass, Trash2, Zap } from "lucide-react"

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
 * Linear comments), rendered at the end of the thread exactly like queued
 * messages: the thread is not done, it is parked until an event or timeout
 * wakes it. "Wake now" wakes the agent immediately without the event; the
 * trash button cancels the wait and leaves the thread parked. */
export function ThreadWaits({ threadId }: { threadId: Id<"threads"> | null }) {
  const waits = useQuery(
    api.factoryWaits.listThreadWaits,
    threadId ? { threadId } : "skip"
  )
  const wakeWait = useAction(api.factoryWaits.userWakeWait)
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

  const runWaitAction = (
    waitId: Id<"factoryWaits">,
    run: () => Promise<unknown>
  ) => {
    setBusyWaitIds((prev) => new Set(prev).add(waitId))
    void run()
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
    <div className="flex flex-col gap-1.5">
      {waits.map((wait) => {
        const busy = busyWaitIds.has(wait.waitId)
        return (
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
            <button
              type="button"
              onClick={() =>
                runWaitAction(wait.waitId, () =>
                  wakeWait({ waitId: wait.waitId })
                )
              }
              disabled={busy}
              title="Stop waiting and wake the agent now"
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <Zap className="size-3.5" />
              Wake now
            </button>
            <ComposerIconButton
              onClick={() =>
                runWaitAction(wait.waitId, () =>
                  cancelWait({ waitId: wait.waitId })
                )
              }
              disabled={busy}
              aria-label="Cancel wait"
              title="Cancel"
            >
              <Trash2 className="size-4" />
            </ComposerIconButton>
          </div>
        )
      })}
    </div>
  )
}
