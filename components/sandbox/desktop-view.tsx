"use client"

import { Loader2, Maximize2, Monitor, Play, Square } from "lucide-react"
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  SandboxDesktopIconButton,
  SandboxDesktopIconLink,
} from "@/components/sandbox/desktop-controls"
import {
  desktopWebSocketUrl,
  type BusyKind,
} from "@/components/sandbox/desktop-model"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/shared/utils"

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

export function DesktopView({
  previewUrl,
  connectRequested,
  hasActiveRecording,
  busy,
  statusKnown,
  viewerActive,
  sandboxId,
  onConnect,
  onDisconnect,
  onConnectionLost,
  onStart,
  onStop,
}: {
  previewUrl: string | null
  connectRequested: boolean
  hasActiveRecording: boolean
  busy: BusyKind | null
  statusKnown: boolean
  viewerActive: boolean
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
  const runningTitle =
    busy === "stop" ? "Stopping desktop..." : "Desktop is running"
  const runningDescription =
    busy === "stop"
      ? "Closing the desktop session."
      : "Connect to view and control it."
  const offTitle =
    busy === "start"
      ? "Starting desktop..."
      : statusKnown
        ? "Desktop is off"
        : "Checking desktop..."
  const offDescription =
    busy === "start"
      ? "Starting the virtual desktop."
      : statusKnown
        ? "Start the virtual desktop to watch and control it live over VNC."
        : "Checking the current desktop state."

  return (
    <div
      className={cn(
        "relative h-full min-h-0 overflow-hidden",
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
          title={runningTitle}
          description={runningDescription}
          action={
            <Button size="sm" onClick={onConnect} disabled={actionsDisabled}>
              <Monitor />
              Connect
            </Button>
          }
        />
      ) : (
        <DesktopPlaceholder
          title={offTitle}
          description={offDescription}
          action={
            <Button
              size="sm"
              onClick={onStart}
              disabled={!sandboxId || actionsDisabled || !statusKnown}
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
        <span className="pointer-events-none absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/85 px-2 py-1 text-[10px] font-medium tracking-wide text-destructive uppercase shadow-sm backdrop-blur">
          <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
          Rec
        </span>
      ) : null}

      {hasPreview ? (
        <div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/80 p-0.5 shadow-sm backdrop-blur">
          <SandboxDesktopIconLink
            href={previewUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            label="Open desktop fullscreen in new tab"
          >
            <Maximize2 className="size-3.5" />
          </SandboxDesktopIconLink>
          {viewerActive ? (
            <Button size="sm" variant="ghost" onClick={onDisconnect}>
              Disconnect
            </Button>
          ) : (
            <SandboxDesktopIconButton
              label="Stop desktop"
              disabled={!sandboxId || actionsDisabled}
              onClick={onStop}
            >
              {busy === "stop" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Square className="size-3.5 fill-current" />
              )}
            </SandboxDesktopIconButton>
          )}
        </div>
      ) : null}
    </div>
  )
}

function DesktopPlaceholder({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
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
  const onDisconnectedEvent = useEffectEvent(onDisconnected)

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
        onDisconnectedEvent()
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
  }, [webSocketUrl])

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
