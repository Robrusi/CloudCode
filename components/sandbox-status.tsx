"use client"

import { Check, Loader2, Pause, Save, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

type SandboxInfo = {
  startedAt: number
  endAt: number
  state: "running" | "paused"
}

export function SnapshotStatus({
  deleting,
  onDelete,
}: {
  deleting: boolean
  onDelete: () => void | Promise<void>
}) {
  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        aria-label="Delete sandbox snapshot"
        title="Delete sandbox snapshot"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
      >
        {deleting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
        <span>{deleting ? "Deleting" : "Delete snapshot"}</span>
      </button>
    </div>
  )
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "0s"
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`
  return `${s}s`
}

function formatElapsed(ms: number) {
  if (ms < 60_000) {
    const s = Math.floor(ms / 1000)
    return `${s} ${s === 1 ? "second" : "seconds"}`
  }
  if (ms < 3600_000) {
    const m = Math.floor(ms / 60_000)
    return `${m} ${m === 1 ? "minute" : "minutes"}`
  }
  const totalMinutes = Math.floor(ms / 60_000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (m === 0) return `${h} ${h === 1 ? "hour" : "hours"}`
  return `${h}h ${m}m`
}

export function SandboxStatus({
  sandboxId,
  onKill,
  onPause,
  onSave,
  hideActions = false,
}: {
  sandboxId: string
  onKill: () => void | Promise<void>
  onPause: () => void | Promise<void>
  onSave: () => void | Promise<void>
  hideActions?: boolean
}) {
  const [info, setInfo] = useState<SandboxInfo | null>(null)
  const [missing, setMissing] = useState(false)
  const [killing, setKilling] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [now, setNow] = useState(() => Date.now())

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
          setMissing(true)
          setInfo(null)
          return
        }
        setMissing(false)
        setInfo({
          startedAt: data.startedAt,
          endAt: data.endAt,
          state: data.state === "paused" ? "paused" : "running",
        })
      } catch {
        if (!cancelled) setMissing(true)
      }
    }

    const firstLoad = window.setTimeout(() => {
      setInfo(null)
      setMissing(false)
      void load()
    }, 0)
    const id = window.setInterval(load, 15_000)
    return () => {
      cancelled = true
      window.clearTimeout(firstLoad)
      window.clearInterval(id)
    }
  }, [sandboxId])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  async function handleKill() {
    if (killing || pausing || saving) return
    setKilling(true)
    try {
      await onKill()
    } finally {
      setKilling(false)
    }
  }

  async function handlePause() {
    if (killing || pausing || saving || info?.state === "paused") return
    setPausing(true)
    try {
      await onPause()
      setInfo((current) =>
        current
          ? {
              ...current,
              state: "paused",
              endAt: Date.now(),
            }
          : current
      )
    } finally {
      setPausing(false)
    }
  }

  async function handleSave() {
    if (saving || killing || pausing) return
    setSaving(true)
    setSaved(false)
    try {
      await onSave()
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  if (missing) {
    return (
      <span className="text-xs text-muted-foreground">Sandbox not running</span>
    )
  }

  const elapsed = info
    ? Math.max(0, (info.state === "paused" ? info.endAt : now) - info.startedAt)
    : 0
  const remaining = info ? Math.max(0, info.endAt - now) : 0

  const timeoutLabel = info?.state === "paused" ? "Paused" : "Idle timeout"
  const timeoutValue =
    info?.state === "paused"
      ? "Sleeping"
      : info
        ? formatCountdown(remaining)
        : "-"
  const tooltip = info
    ? `Sandbox ${sandboxId}\nState ${info.state}\nStarted ${new Date(info.startedAt).toLocaleString()}\nIdles out ${new Date(info.endAt).toLocaleString()}`
    : `Sandbox ${sandboxId}`

  return (
    <div className="flex items-center gap-6">
      <Stat label={timeoutLabel} value={timeoutValue} title={tooltip} />
      {info?.state === "paused" ? null : (
        <Stat
          label="Running for"
          value={info ? formatElapsed(elapsed) : "-"}
          title={tooltip}
        />
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || killing || pausing}
        aria-label="Save sandbox"
        title="Save sandbox"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        {saving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : saved ? (
          <Check className="size-3.5" />
        ) : (
          <Save className="size-3.5" />
        )}
        {hideActions ? null : (
          <span>{saving ? "Saving" : saved ? "Saved" : "Save sandbox"}</span>
        )}
      </button>
      <button
        type="button"
        onClick={handlePause}
        disabled={pausing || saving || killing || info?.state === "paused"}
        aria-label="Pause sandbox"
        title="Pause sandbox"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        {pausing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Pause className="size-3.5" />
        )}
        {hideActions ? null : (
          <span>{pausing ? "Pausing" : "Pause sandbox"}</span>
        )}
      </button>
      <button
        type="button"
        onClick={handleKill}
        disabled={killing || saving || pausing}
        aria-label="Kill sandbox"
        title="Kill sandbox"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
      >
        {killing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
        {hideActions ? null : (
          <span>{killing ? "Killing" : "Kill sandbox"}</span>
        )}
      </button>
    </div>
  )
}

function Stat({
  label,
  value,
  title,
}: {
  label: string
  value: string
  title?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 leading-none" title={title}>
      <span className="text-[9px] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-[13px] text-foreground tabular-nums">{value}</span>
    </div>
  )
}
