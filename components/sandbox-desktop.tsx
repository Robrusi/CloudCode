"use client"

import {
  Download,
  Loader2,
  Maximize2,
  Monitor,
  Play,
  RefreshCw,
  Square,
  X,
} from "lucide-react"
import {
  type AnchorHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  RecordingVideo,
  recordingRequestUrl,
} from "@/components/recording-video"
import { ResizeHandle } from "@/components/resize-handle"
import { Button } from "@/components/ui/button"
import {
  IconButton as UiIconButton,
  iconButtonVariants,
} from "@/components/ui/icon-button"
import { cardSurfaceClass } from "@/components/ui/surface"
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

type DesktopView = "desktop" | "recordings"

type BusyKind = "refresh" | "start" | "stop"

const RECORDINGS_POLL_MS = 8000

type NoVncRfb = {
  addEventListener: (
    type: "connect" | "credentialsrequired" | "disconnect" | "securityfailure",
    listener: (event: CustomEvent) => void
  ) => void
  compressionLevel: number
  disconnect: () => void
  focusOnClick: boolean
  qualityLevel: number
  resizeSession: boolean
  scaleViewport: boolean
}

type NoVncConstructor = new (
  target: HTMLElement,
  url: string,
  options?: { shared?: boolean }
) => NoVncRfb

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

// Status can lag when computer use starts outside this panel. Renderable
// preview URLs are handled separately so the panel does not hide a live desktop.
function isDesktopActive(status: string) {
  const value = status.toLowerCase().trim()
  if (!value || value === "unknown") return false
  if (
    value.includes("error") ||
    value.includes("fail") ||
    value.includes("inactive") ||
    value.includes("not started") ||
    value.includes("stop") ||
    value.includes("unable")
  ) {
    return false
  }
  return (
    value.includes("active") ||
    value.includes("running") ||
    value.includes("start") ||
    value.includes("up")
  )
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes < 1) return ""
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(seconds?: number) {
  if (!seconds || seconds < 1) return ""
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}

function recordingTitle(recording: DesktopRecording) {
  return (recording.fileName || recording.id).replace(/\.mp4$/i, "")
}

function formatRecordingMeta(recording: DesktopRecording) {
  return [
    formatDuration(recording.durationSeconds),
    formatBytes(recording.sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ")
}

function desktopWebSocketUrl(previewUrl: string) {
  try {
    const url = new URL(previewUrl)
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
    url.pathname = "/websockify"
    for (const param of ["autoconnect", "path", "reconnect", "resize"]) {
      url.searchParams.delete(param)
    }
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
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
  const [view, setView] = useState<DesktopView>("desktop")
  const [status, setStatus] = useState<DesktopStatus | null>(null)
  const [recordings, setRecordings] = useState<DesktopRecording[]>([])
  const [busy, setBusy] = useState<BusyKind | null>(null)
  const [connectRequested, setConnectRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    setConnectRequested(false)
  }, [open, sandboxId])

  useEffect(() => {
    if (!status?.previewUrl) {
      setConnectRequested(false)
    }
  }, [status?.previewUrl])

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
  const requestConnect = useCallback(() => {
    if (!busy) {
      setConnectRequested(true)
    }
  }, [busy])
  const disconnect = useCallback(() => setConnectRequested(false), [])
  const handleConnectionLost = useCallback(() => {
    setConnectRequested(false)
    void refresh()
  }, [refresh])

  async function startDesktop() {
    if (!sandboxId || busy) return
    setBusy("start")
    setError(null)
    try {
      const next = await postJson<DesktopStatus>("/api/sandbox/desktop", {
        action: "start",
        sandboxId,
      })
      setStatus(next)
      setConnectRequested(Boolean(next.previewUrl))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Desktop start failed.")
    } finally {
      setBusy(null)
    }
  }

  async function stopDesktop() {
    if (!sandboxId || busy) return
    setBusy("stop")
    setError(null)
    setConnectRequested(false)
    try {
      const next = await postJson<DesktopStatus>("/api/sandbox/desktop", {
        action: "stop",
        sandboxId,
      })
      setStatus(next)
      setConnectRequested(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Desktop stop failed.")
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null

  const previewUrl = status?.previewUrl ?? null
  const desktopActive =
    Boolean(previewUrl) && isDesktopActive(status?.status ?? "")
  const hasActiveRecording = Boolean(activeRecording)
  const connected = Boolean(previewUrl && connectRequested)

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
        <span className="text-sm font-medium text-foreground/85">Computer</span>
        {busy ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        <div className="ml-auto flex items-center gap-1">
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
        </div>
      </header>

      <div className="flex h-[3.25rem] shrink-0 items-stretch border-b border-border/60">
        <ViewButton
          active={view === "desktop"}
          label="Desktop"
          onClick={() => setView("desktop")}
        />
        <div aria-hidden className="w-px self-stretch bg-border/60" />
        <ViewButton
          active={view === "recordings"}
          label="Recordings"
          count={recordings.length}
          onClick={() => setView("recordings")}
        />
      </div>

      {error ? (
        <div className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "desktop" ? (
          <DesktopView
            previewUrl={previewUrl}
            connectRequested={connectRequested}
            desktopActive={desktopActive}
            hasActiveRecording={hasActiveRecording}
            busy={busy}
            connected={connected}
            sandboxId={sandboxId}
            onConnect={requestConnect}
            onDisconnect={disconnect}
            onConnectionLost={handleConnectionLost}
            onStart={startDesktop}
            onStop={stopDesktop}
          />
        ) : (
          <RecordingsView recordings={recordings} sandboxId={sandboxId} />
        )}
      </div>
    </aside>
  )
}

function DesktopView({
  previewUrl,
  connectRequested,
  desktopActive,
  hasActiveRecording,
  busy,
  connected,
  sandboxId,
  onConnect,
  onDisconnect,
  onConnectionLost,
  onStart,
  onStop,
}: {
  previewUrl: string | null
  connectRequested: boolean
  desktopActive: boolean
  hasActiveRecording: boolean
  busy: BusyKind | null
  connected: boolean
  sandboxId: string | null
  onConnect: () => void
  onDisconnect: () => void
  onConnectionLost: () => void
  onStart: () => void
  onStop: () => void
}) {
  const hasPreview = Boolean(previewUrl)
  const actionsDisabled = Boolean(busy)
  const webSocketUrl = useMemo(
    () =>
      previewUrl && connectRequested ? desktopWebSocketUrl(previewUrl) : null,
    [connectRequested, previewUrl]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <StatusPill active={desktopActive} preview={hasPreview} />
        <div className="flex items-center gap-1.5">
          {hasPreview ? (
            <IconLink
              href={previewUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              label="Open desktop fullscreen in new tab"
            >
              <Maximize2 className="size-3.5" />
            </IconLink>
          ) : null}
          {connected ? (
            <>
              <Button size="sm" variant="outline" onClick={onDisconnect}>
                <Square className="fill-current" />
                Disconnect
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onStop}
                disabled={!sandboxId || actionsDisabled}
              >
                {busy === "stop" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Square className="fill-current" />
                )}
                Stop
              </Button>
            </>
          ) : hasPreview ? (
            <>
              <Button size="sm" onClick={onConnect} disabled={actionsDisabled}>
                <Monitor />
                Connect
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onStop}
                disabled={!sandboxId || actionsDisabled}
              >
                {busy === "stop" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Square className="fill-current" />
                )}
                Stop
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={onStart}
              disabled={!sandboxId || actionsDisabled}
            >
              {busy === "start" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Play />
              )}
              Start desktop
            </Button>
          )}
        </div>
      </div>

      <div
        className={cn(
          "relative min-h-0 flex-1",
          webSocketUrl ? "bg-black" : "bg-sidebar"
        )}
      >
        {webSocketUrl ? (
          <NoVncDesktop
            webSocketUrl={webSocketUrl}
            onDisconnected={onConnectionLost}
          />
        ) : hasPreview ? (
          <DesktopPlaceholder
            title="Desktop preview is ready"
            description="Connect when you want to view and control the live VNC session."
            action={
              <Button size="sm" onClick={onConnect} disabled={actionsDisabled}>
                <Monitor />
                Connect
              </Button>
            }
          />
        ) : (
          <DesktopPlaceholder
            title="Desktop is off"
            description="Start the virtual desktop to watch and control it live over VNC."
            action={
              <Button
                size="sm"
                onClick={onStart}
                disabled={!sandboxId || actionsDisabled}
              >
                {busy === "start" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Play />
                )}
                Start desktop
              </Button>
            }
          />
        )}
        {hasActiveRecording ? (
          <span className="pointer-events-none absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/85 px-2 py-1 text-[10px] font-medium tracking-wide text-destructive uppercase shadow-sm backdrop-blur">
            <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
            Rec
          </span>
        ) : null}
      </div>
    </div>
  )
}

function StatusPill({
  active,
  preview,
}: {
  active: boolean
  preview: boolean
}) {
  const label = active ? "Running" : preview ? "Preview" : "Idle"
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/50 py-0.5 pr-2.5 pl-2 text-[11px] font-medium text-muted-foreground">
      <span
        className={cn(
          "size-1.5 rounded-full",
          active
            ? "bg-success"
            : preview
              ? "bg-foreground/40"
              : "bg-muted-foreground/40"
        )}
      />
      {label}
    </span>
  )
}

function DesktopPlaceholder({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground/85">{title}</p>
        <p className="max-w-[15rem] text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  )
}

function NoVncDesktop({
  webSocketUrl,
  onDisconnected,
}: {
  webSocketUrl: string
  onDisconnected: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState("Connecting desktop...")

  useEffect(() => {
    let disposed = false
    let rfb: NoVncRfb | null = null

    async function connect() {
      setMessage("Connecting desktop...")

      const target = containerRef.current
      if (!target) return
      target.replaceChildren()

      const novncModule = (await import("@novnc/novnc")) as {
        default: NoVncConstructor
      }
      if (disposed) return

      rfb = new novncModule.default(target, webSocketUrl, {
        shared: true,
      })
      rfb.scaleViewport = true
      rfb.resizeSession = false
      rfb.focusOnClick = true
      rfb.qualityLevel = 7
      rfb.compressionLevel = 2

      rfb.addEventListener("connect", () => {
        if (!disposed) setMessage("")
      })
      rfb.addEventListener("credentialsrequired", () => {
        if (!disposed) setMessage("Desktop connection requires credentials.")
      })
      rfb.addEventListener("disconnect", (event) => {
        rfb = null
        if (disposed) return
        const clean =
          typeof event.detail === "object" &&
          event.detail !== null &&
          "clean" in event.detail &&
          event.detail.clean === true
        setMessage(clean ? "Desktop disconnected." : "Desktop connection lost.")
        onDisconnected()
      })
      rfb.addEventListener("securityfailure", () => {
        if (!disposed) setMessage("Desktop security negotiation failed.")
      })
    }

    void connect().catch((error) => {
      if (!disposed) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to connect to the desktop."
        )
      }
    })

    return () => {
      disposed = true
      try {
        rfb?.disconnect()
      } catch {
        // noVNC throws if disconnect is called after it has already reached its
        // terminal disconnected state.
      }
    }
  }, [onDisconnected, webSocketUrl])

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div
        ref={containerRef}
        className="h-full w-full [&_canvas]:outline-none"
      />
      {message ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/70 px-6 text-center">
          <p className="max-w-[18rem] text-xs text-white/80">{message}</p>
        </div>
      ) : null}
    </div>
  )
}

function RecordingsView({
  recordings,
  sandboxId,
}: {
  recordings: DesktopRecording[]
  sandboxId: string | null
}) {
  if (!recordings.length || !sandboxId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm font-medium text-foreground/85">
          No recordings yet
        </p>
        <p className="max-w-[15rem] text-xs text-muted-foreground">
          Recordings captured of the desktop will show up here.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full space-y-2 overflow-y-auto p-3">
      {recordings.map((recording) => (
        <RecordingRow
          key={recording.id}
          recording={recording}
          sandboxId={sandboxId}
        />
      ))}
    </div>
  )
}

function RecordingRow({
  recording,
  sandboxId,
}: {
  recording: DesktopRecording
  sandboxId: string
}) {
  const [open, setOpen] = useState(false)
  const live = isActiveRecording(recording)
  const meta = formatRecordingMeta(recording)
  const title = recordingTitle(recording)
  const downloadUrl = recordingRequestUrl(recording, {
    inline: false,
    sandboxId,
  })

  return (
    <div
      className={cn("overflow-hidden", cardSurfaceClass, "bg-background/40")}
    >
      <button
        type="button"
        onClick={() => !live && setOpen((value) => !value)}
        disabled={live}
        aria-expanded={live ? undefined : open}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
          !live && "cursor-pointer hover:bg-sidebar-accent/50"
        )}
      >
        <div
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md",
            live
              ? "bg-destructive/10 text-destructive"
              : "bg-sidebar-accent/60 text-muted-foreground"
          )}
        >
          {live ? (
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
          ) : (
            <Play className="size-3.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground/85">{title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {live ? "Recording…" : meta || "Ready"}
          </p>
        </div>
        {!live ? (
          <IconLink
            href={downloadUrl ?? "#"}
            label={`Download ${title}`}
            onClick={(event) => event.stopPropagation()}
          >
            <Download className="size-3.5" />
          </IconLink>
        ) : null}
      </button>
      {open && !live ? (
        <div className="border-t border-border/60 bg-muted/30 p-2">
          <RecordingVideo
            aria-label={`Recording: ${title}`}
            recording={recording}
            sandboxId={sandboxId}
          />
        </div>
      ) : null}
    </div>
  )
}

function ViewButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 text-center text-xs font-medium transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      {count ? (
        <span
          className={cn(
            "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]",
            active
              ? "bg-foreground/10 text-foreground"
              : "bg-muted-foreground/15 text-muted-foreground"
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
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
    <UiIconButton
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      {children}
    </UiIconButton>
  )
}

function IconLink({
  children,
  label,
  className,
  ...props
}: {
  children: ReactNode
  label: string
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      aria-label={label}
      title={label}
      className={cn(iconButtonVariants(), className)}
      {...props}
    >
      {children}
    </a>
  )
}
