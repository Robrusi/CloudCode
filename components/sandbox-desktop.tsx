"use client"

import {
  Camera,
  Download,
  ExternalLink,
  Globe2,
  Loader2,
  Monitor,
  Play,
  RefreshCw,
  Square,
  Video,
  X,
} from "lucide-react"
import Image from "next/image"
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"

import { ResizeHandle } from "@/components/resize-handle"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { cn } from "@/lib/utils"

type DesktopStatus = {
  previewUrl: string | null
  status: string
}

type DesktopRecording = {
  durationSeconds?: number
  endTime?: string
  fileName: string
  filePath: string
  id: string
  sizeBytes?: number
  startTime: string
  status: string
}

type RecordingsResponse = {
  recordings: DesktopRecording[]
}

type BusyKind =
  | "browser"
  | "record-start"
  | "record-stop"
  | "refresh"
  | "start"
  | "stop"

const RECORDINGS_POLL_MS = 8000

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.")
  }
  return data as T
}

function postJson<T>(url: string, body: unknown) {
  return fetchJson<T>(url, {
    body: JSON.stringify(body),
    method: "POST",
  })
}

function isActiveRecording(recording: DesktopRecording) {
  const status = recording.status.toLowerCase()
  return status === "active" || status === "recording" || status === "running"
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes < 1) return ""
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatRecordingMeta(recording: DesktopRecording) {
  const parts = [
    recording.status,
    recording.durationSeconds
      ? `${Math.round(recording.durationSeconds)}s`
      : "",
    formatBytes(recording.sizeBytes),
  ].filter(Boolean)
  return parts.join(" · ")
}

export function SandboxDesktopPanel({
  open,
  sandboxId,
  onClose,
}: {
  open: boolean
  sandboxId: string | null
  onClose: () => void
}) {
  const isMobile = useIsMobile()
  const { width, resizing, onResizeStart, resetWidth } = useResizablePanel({
    storageKey: "cloudcode:desktopPanelWidth",
    defaultWidth: 520,
    minWidth: 360,
    maxWidth: 860,
    edge: "left",
    enabled: !isMobile,
  })
  const [status, setStatus] = useState<DesktopStatus | null>(null)
  const [recordings, setRecordings] = useState<DesktopRecording[]>([])
  const [busy, setBusy] = useState<BusyKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [screenshotVersion, setScreenshotVersion] = useState(0)

  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return null
      const params = new URLSearchParams({ sandboxId })
      const next = await fetchJson<DesktopStatus>(
        `/api/sandbox/desktop?${params}`,
        { signal }
      )
      setStatus(next)
      return next
    },
    [sandboxId]
  )

  const loadRecordings = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return []
      const params = new URLSearchParams({ sandboxId })
      const next = await fetchJson<RecordingsResponse>(
        `/api/sandbox/desktop/recordings?${params}`,
        { signal }
      )
      setRecordings(next.recordings)
      return next.recordings
    },
    [sandboxId]
  )

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return
      setBusy((current) => current ?? "refresh")
      try {
        await Promise.all([loadStatus(signal), loadRecordings(signal)])
        setError(null)
      } catch (err) {
        if (!signal?.aborted) {
          setError(
            err instanceof Error ? err.message : "Desktop refresh failed."
          )
        }
      } finally {
        if (!signal?.aborted) {
          setBusy((current) => (current === "refresh" ? null : current))
        }
      }
    },
    [loadRecordings, loadStatus, sandboxId]
  )

  useEffect(() => {
    if (!open || !sandboxId) return
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [open, refresh, sandboxId])

  useEffect(() => {
    if (!open || !sandboxId) return
    const interval = window.setInterval(() => {
      void loadRecordings().catch(() => undefined)
    }, RECORDINGS_POLL_MS)
    return () => window.clearInterval(interval)
  }, [loadRecordings, open, sandboxId])

  const activeRecording = useMemo(
    () => recordings.find(isActiveRecording) ?? null,
    [recordings]
  )

  const screenshotUrl = useMemo(() => {
    if (!sandboxId || screenshotVersion === 0) return null
    return `/api/sandbox/desktop/screenshot?${new URLSearchParams({
      sandboxId,
      t: String(screenshotVersion),
    })}`
  }, [sandboxId, screenshotVersion])

  async function startDesktop() {
    if (!sandboxId) return
    setBusy("start")
    try {
      const next = await postJson<DesktopStatus>("/api/sandbox/desktop", {
        action: "start",
        sandboxId,
      })
      setStatus(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Desktop start failed.")
    } finally {
      setBusy(null)
    }
  }

  async function stopDesktop() {
    if (!sandboxId) return
    setBusy("stop")
    try {
      await postJson<unknown>("/api/sandbox/desktop", {
        action: "stop",
        sandboxId,
      })
      setStatus({ previewUrl: null, status: "stopped" })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Desktop stop failed.")
    } finally {
      setBusy(null)
    }
  }

  async function openBrowser() {
    if (!sandboxId) return
    setBusy("browser")
    try {
      const next = await postJson<DesktopStatus>("/api/sandbox/desktop", {
        action: "open-browser",
        sandboxId,
      })
      setStatus(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Browser open failed.")
    } finally {
      setBusy(null)
    }
  }

  async function startRecording() {
    if (!sandboxId) return
    setBusy("record-start")
    try {
      const recording = await postJson<DesktopRecording>(
        "/api/sandbox/desktop/recordings",
        {
          action: "start",
          label: `desktop-${new Date().toISOString().replace(/[:.]/g, "-")}`,
          sandboxId,
        }
      )
      setRecordings((current) => [recording, ...current])
      await Promise.all([loadStatus(), loadRecordings()])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recording start failed.")
    } finally {
      setBusy(null)
    }
  }

  async function stopRecording() {
    if (!sandboxId || !activeRecording) return
    setBusy("record-stop")
    try {
      await postJson<DesktopRecording>("/api/sandbox/desktop/recordings", {
        action: "stop",
        recordingId: activeRecording.id,
        sandboxId,
      })
      await loadRecordings()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recording stop failed.")
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null

  const previewUrl = status?.previewUrl ?? null
  const desktopStatus = status?.status ?? "unknown"
  const hasActiveRecording = Boolean(activeRecording)

  return (
    <aside
      className="fixed inset-0 z-40 flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border/60 bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:relative md:inset-auto md:z-auto md:w-[var(--panel-width)] md:shrink-0 md:pt-0 md:pb-0"
      style={{ "--panel-width": `${width}px` } as CSSProperties}
      data-sandbox-desktop
    >
      <ResizeHandle
        edge="left"
        resizing={resizing}
        onResizeStart={onResizeStart}
        onReset={resetWidth}
        ariaLabel="Resize desktop panel"
      />
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <Monitor className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground/85">Desktop</span>
        {busy ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        <span className="ml-auto rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
          {desktopStatus}
        </span>
        <IconButton
          label="Refresh desktop"
          disabled={!sandboxId || Boolean(busy)}
          onClick={() => void refresh()}
        >
          <RefreshCw className="size-3.5" />
        </IconButton>
        <IconButton label="Close desktop panel" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <PanelButton
          onClick={startDesktop}
          disabled={!sandboxId || busy === "start"}
          loading={busy === "start"}
        >
          <Play className="size-3.5" />
          Start
        </PanelButton>
        <PanelButton
          onClick={stopDesktop}
          disabled={!sandboxId || busy === "stop"}
          loading={busy === "stop"}
        >
          <Square className="size-3.5" />
          Stop
        </PanelButton>
        <PanelButton
          onClick={() => setScreenshotVersion(Date.now())}
          disabled={!sandboxId}
        >
          <Camera className="size-3.5" />
          Screenshot
        </PanelButton>
        <PanelButton
          onClick={openBrowser}
          disabled={!sandboxId || busy === "browser"}
          loading={busy === "browser"}
        >
          <Globe2 className="size-3.5" />
          Browser
        </PanelButton>
        <PanelButton
          onClick={hasActiveRecording ? stopRecording : startRecording}
          disabled={
            !sandboxId || busy === "record-start" || busy === "record-stop"
          }
          loading={busy === "record-start" || busy === "record-stop"}
        >
          {hasActiveRecording ? (
            <Square className="size-3.5" />
          ) : (
            <Video className="size-3.5" />
          )}
          {hasActiveRecording ? "Stop recording" : "Record"}
        </PanelButton>
      </div>

      {error ? (
        <div className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col">
          <div className="min-h-[320px] flex-1 border-b border-border/60 bg-black">
            {previewUrl ? (
              <iframe
                title="Daytona desktop"
                src={previewUrl}
                allow="clipboard-read; clipboard-write"
                className="h-full min-h-[320px] w-full border-0 bg-black"
              />
            ) : screenshotUrl ? (
              <Image
                src={screenshotUrl}
                alt="Daytona desktop screenshot"
                width={1440}
                height={900}
                unoptimized
                className="h-full min-h-[320px] w-full object-contain"
              />
            ) : (
              <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center">
                <p className="text-xs text-muted-foreground">
                  Desktop preview is not running.
                </p>
              </div>
            )}
          </div>

          {screenshotUrl && previewUrl ? (
            <div className="border-b border-border/60 px-3 py-3">
              <Image
                src={screenshotUrl}
                alt="Latest desktop screenshot"
                width={1440}
                height={900}
                unoptimized
                className="aspect-video w-full rounded-md border border-border/60 bg-black object-contain"
              />
            </div>
          ) : null}

          <section className="px-3 py-3">
            <div className="mb-2 flex items-center gap-2">
              <Video className="size-3.5 text-muted-foreground" />
              <h2 className="text-xs font-medium text-muted-foreground">
                Recordings
              </h2>
            </div>
            {recordings.length ? (
              <div className="overflow-hidden rounded-md border border-border/60">
                {recordings.map((recording) => (
                  <div
                    key={recording.id}
                    className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground/85">
                        {recording.fileName || recording.id}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatRecordingMeta(recording) || recording.id}
                      </p>
                    </div>
                    {!isActiveRecording(recording) ? (
                      <a
                        href={`/api/sandbox/desktop/recordings?${new URLSearchParams(
                          {
                            download: "1",
                            recordingId: recording.id,
                            sandboxId: sandboxId ?? "",
                          }
                        )}`}
                        aria-label={`Download ${recording.fileName}`}
                        title="Download"
                        className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                      >
                        <Download className="size-3.5" />
                      </a>
                    ) : (
                      <span className="rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                        live
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No recordings yet.
              </p>
            )}
          </section>

          {previewUrl ? (
            <div className="mt-auto border-t border-border/60 px-3 py-3">
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
                Open preview
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}

function IconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function PanelButton({
  children,
  disabled,
  loading,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-8 items-center gap-2 rounded-md border border-border/60 px-2.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        loading && "text-muted-foreground"
      )}
    >
      <span
        className={cn("inline-flex items-center gap-2", loading && "opacity-0")}
      >
        {children}
      </span>
      {loading ? (
        <Loader2 className="absolute left-1/2 size-3.5 -translate-x-1/2 animate-spin" />
      ) : null}
    </button>
  )
}
