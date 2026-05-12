"use client"

import { useEffect, useRef, useState } from "react"

export type SandboxInfo = {
  autoStopInterval: number | null
  lastActivityAt: number | null
  sandboxId?: string
  rawState?: string
  state: "running" | "stopped" | "deleted" | "error"
}

export const SANDBOX_STATE_LABEL: Record<SandboxInfo["state"], string> = {
  deleted: "Deleted",
  error: "Error",
  running: "Running",
  stopped: "Idle",
}

export function formatSandboxAutoStop(value: number | null) {
  if (value === null) return "Daytona managed"
  if (value === 0) return "No auto-stop"
  if (value < 60) return `${value}m auto-stop`
  const hours = Math.round((value / 60) * 10) / 10
  return `${hours}h auto-stop`
}

function parseSandboxInfo(data: Record<string, unknown>): SandboxInfo {
  return {
    autoStopInterval:
      typeof data.autoStopInterval === "number" ? data.autoStopInterval : null,
    lastActivityAt:
      typeof data.lastActivityAt === "number" ? data.lastActivityAt : null,
    rawState: typeof data.rawState === "string" ? data.rawState : "",
    sandboxId: typeof data.sandboxId === "string" ? data.sandboxId : undefined,
    state:
      data.state === "stopped" ||
      data.state === "deleted" ||
      data.state === "error"
        ? data.state
        : "running",
  }
}

export type UseSandboxInfoResult = {
  info: SandboxInfo | null
  loading: boolean
  missing: boolean
}

export function useSandboxInfo({
  onStateChange,
  sandboxId,
}: {
  onStateChange?: (
    state: SandboxInfo["state"],
    sandboxId: string,
    info: SandboxInfo
  ) => void
  sandboxId: string | null
}): UseSandboxInfoResult {
  const [info, setInfo] = useState<SandboxInfo | null>(null)
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const onStateChangeRef = useRef(onStateChange)

  useEffect(() => {
    onStateChangeRef.current = onStateChange
  }, [onStateChange])

  useEffect(() => {
    let cancelled = false
    let fallbackInterval: number | undefined

    function applyInfo(nextInfo: SandboxInfo) {
      setMissing(false)
      setInfo(nextInfo)
      setLoading(false)
      if (nextInfo.sandboxId) {
        onStateChangeRef.current?.(nextInfo.state, nextInfo.sandboxId, nextInfo)
      }
    }

    async function load() {
      if (!sandboxId) {
        setInfo(null)
        setMissing(false)
        setLoading(false)
        return
      }

      try {
        const res = await fetch(
          `/api/sandbox/info?sandboxId=${encodeURIComponent(sandboxId)}`,
          { cache: "no-store" }
        )
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setMissing(Boolean(data?.notFound))
          if (data?.notFound) {
            onStateChangeRef.current?.("deleted", sandboxId, {
              autoStopInterval: null,
              lastActivityAt: null,
              sandboxId,
              state: "deleted",
            })
          }
          return
        }
        applyInfo(parseSandboxInfo(data))
      } catch {
        if (!cancelled) setMissing(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (!sandboxId) {
      return
    }

    const source = new EventSource(
      `/api/sandbox/status?sandboxId=${encodeURIComponent(sandboxId)}`
    )

    source.onmessage = (event) => {
      if (cancelled) return
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>
        if (data.notFound) {
          setInfo(null)
          setMissing(true)
          setLoading(false)
          onStateChangeRef.current?.("deleted", sandboxId, {
            autoStopInterval: null,
            lastActivityAt: null,
            sandboxId,
            state: "deleted",
          })
          source.close()
          return
        }
        applyInfo(parseSandboxInfo(data))
      } catch {
        // Ignore malformed stream events and let the next status event repair it.
      }
    }

    source.onerror = () => {
      if (cancelled || fallbackInterval) return
      source.close()
      void load()
      fallbackInterval = window.setInterval(load, 2_000)
    }

    return () => {
      cancelled = true
      source.close()
      if (fallbackInterval) window.clearInterval(fallbackInterval)
    }
  }, [sandboxId])

  return { info, loading, missing }
}
