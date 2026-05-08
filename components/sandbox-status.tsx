"use client"

import { CircleDot, Loader2, OctagonX, Power } from "lucide-react"
import { useEffect, useState } from "react"

type SandboxInfo = {
  autoStopInterval: number | null
  lastActivityAt: number | null
  rawState?: string
  state: "running" | "stopped" | "deleted" | "error"
}

const STATE_LABEL: Record<SandboxInfo["state"], string> = {
  deleted: "Deleted",
  error: "Error",
  running: "Running",
  stopped: "Stopped",
}

function formatMinutes(value: number | null) {
  if (value === null) return "Daytona managed"
  if (value === 0) return "No auto-stop"
  if (value < 60) return `${value}m auto-stop`
  const hours = Math.round((value / 60) * 10) / 10
  return `${hours}h auto-stop`
}

export function SandboxStatus({ sandboxId }: { sandboxId: string }) {
  const [info, setInfo] = useState<SandboxInfo | null>(null)
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch(
          `/api/sandbox/info?sandboxId=${encodeURIComponent(sandboxId)}`,
          { cache: "no-store" }
        )
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setMissing(Boolean(data?.notFound))
          return
        }
        setMissing(false)
        setInfo({
          autoStopInterval:
            typeof data.autoStopInterval === "number"
              ? data.autoStopInterval
              : null,
          lastActivityAt:
            typeof data.lastActivityAt === "number"
              ? data.lastActivityAt
              : null,
          rawState: typeof data.rawState === "string" ? data.rawState : "",
          state:
            data.state === "stopped" ||
            data.state === "deleted" ||
            data.state === "error"
              ? data.state
              : "running",
        })
      } catch {
        if (!cancelled) setMissing(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const id = window.setInterval(load, 20_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [sandboxId])

  if (loading && !info) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Daytona
      </span>
    )
  }

  if (missing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <OctagonX className="size-3.5" />
        Sandbox missing
      </span>
    )
  }

  if (!info) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Checking
      </span>
    )
  }

  const Icon = info.state === "running" ? CircleDot : Power
  const title = [
    `Daytona sandbox ${sandboxId}`,
    info.rawState ? `State ${info.rawState}` : "",
    info.lastActivityAt
      ? `Last active ${new Date(info.lastActivityAt).toLocaleString()}`
      : "",
    formatMinutes(info.autoStopInterval),
  ]
    .filter(Boolean)
    .join("\n")

  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
    >
      <Icon
        className={
          info.state === "running"
            ? "size-3.5 text-emerald-600 dark:text-emerald-400"
            : "size-3.5"
        }
      />
      <span>{STATE_LABEL[info.state]}</span>
    </span>
  )
}
