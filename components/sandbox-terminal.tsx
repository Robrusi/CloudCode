"use client"

import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { ExternalLink, Loader2, RefreshCw, X } from "lucide-react"
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import { cn } from "@/lib/utils"

type TerminalStatus = "connecting" | "ready" | "reconnecting" | "error"

const terminalClosers = new Map<string, Set<() => void>>()

function registerTerminalCloser(sandboxId: string, close: () => void) {
  const closers = terminalClosers.get(sandboxId) ?? new Set<() => void>()
  closers.add(close)
  terminalClosers.set(sandboxId, closers)

  return () => {
    closers.delete(close)
    if (closers.size === 0) terminalClosers.delete(sandboxId)
  }
}

export function warmBrowserTerminal(sandboxId?: string | null) {
  void sandboxId
  // Daytona PTYs are opened on demand when the panel mounts.
}

export function closeBrowserTerminalSession(sandboxId?: string) {
  if (!sandboxId) return
  for (const close of terminalClosers.get(sandboxId) ?? []) close()
}

export function SandboxTerminalPanel({
  open,
  sandboxId,
  onClose,
  height,
  onHeightChange,
}: {
  open: boolean
  sandboxId: string | null
  onClose: () => void
  height: number
  onHeightChange: (height: number) => void
}) {
  const [externalUrlState, setExternalUrlState] = useState<{
    sandboxId: string
    url: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [externalLoading, setExternalLoading] = useState(false)
  const [status, setStatus] = useState<TerminalStatus>("connecting")
  const [sessionVersion, setSessionVersion] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStartRef = useRef<{ h: number; y: number } | null>(null)

  useEffect(() => {
    if (!open || !sandboxId || !containerRef.current) return

    const terminalId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `cloudcode-${crypto.randomUUID()}`
        : `cloudcode-${Date.now().toString(36)}`
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily:
        '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      fontSize: 13,
      letterSpacing: 0,
      lineHeight: 1.22,
      macOptionIsMeta: true,
      scrollback: 10_000,
      theme: {
        background: "#090909",
        black: "#111111",
        blue: "#7aa2f7",
        brightBlack: "#5c6370",
        brightBlue: "#9ab8ff",
        brightCyan: "#7dd3fc",
        brightGreen: "#8ce99a",
        brightMagenta: "#d8b4fe",
        brightRed: "#ff9b9b",
        brightWhite: "#ffffff",
        brightYellow: "#f8d66d",
        cursor: "#f5f5f5",
        cyan: "#67e8f9",
        foreground: "#ededed",
        green: "#73d13d",
        magenta: "#c084fc",
        red: "#ff6b6b",
        selectionBackground: "#3b3b3b",
        white: "#d7d7d7",
        yellow: "#f4bf75",
      },
    })
    const fitAddon = new FitAddon()
    const node = containerRef.current
    let disposed = false
    let inputFlushTimer: ReturnType<typeof setTimeout> | undefined
    let pendingInput = ""
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let lastSize = { cols: 0, rows: 0 }

    function postTerminal(payload: Record<string, unknown>) {
      if (disposed) return Promise.resolve()
      return fetch("/api/sandbox/terminal/pty", {
        body: JSON.stringify({ sandboxId, terminalId, ...payload }),
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }).then(async (res) => {
        if (res.ok) return
        const data = (await res.json().catch(() => undefined)) as
          | { error?: unknown }
          | undefined
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Terminal request failed."
        )
      })
    }

    function flushInput() {
      if (!pendingInput || disposed) return
      const data = pendingInput
      pendingInput = ""
      void postTerminal({ data }).catch((err) => {
        if (disposed) return
        setStatus("error")
        setError(err instanceof Error ? err.message : "Terminal input failed.")
      })
    }

    function sendResize() {
      if (disposed) return
      try {
        fitAddon.fit()
      } catch {
        return
      }

      const cols = terminal.cols
      const rows = terminal.rows
      if (!cols || !rows) return
      if (cols === lastSize.cols && rows === lastSize.rows) return
      lastSize = { cols, rows }
      void postTerminal({ action: "resize", cols, rows }).catch(() => {
        // The initial resize can race the PTY connection; the GET request also
        // carries the first size, so missing this one is harmless.
      })
    }

    function scheduleResize() {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(sendResize, 50)
    }

    function killTerminal() {
      void fetch("/api/sandbox/terminal/pty", {
        body: JSON.stringify({ sandboxId, terminalId }),
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      }).catch(() => undefined)
    }

    const unregisterCloser = registerTerminalCloser(sandboxId, killTerminal)
    const dataDisposable = terminal.onData((data) => {
      pendingInput += data
      if (inputFlushTimer) return
      inputFlushTimer = setTimeout(() => {
        inputFlushTimer = undefined
        flushInput()
      }, 10)
    })
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(scheduleResize)

    terminal.loadAddon(fitAddon)
    terminal.open(node)
    terminal.focus()
    resizeObserver?.observe(node)
    window.addEventListener("resize", scheduleResize)

    try {
      fitAddon.fit()
      lastSize = { cols: terminal.cols, rows: terminal.rows }
    } catch {
      lastSize = { cols: 100, rows: 30 }
    }

    const params = new URLSearchParams({
      cols: String(lastSize.cols || 100),
      rows: String(lastSize.rows || 30),
      sandboxId,
      terminalId,
    })

    setStatus("connecting")
    setError(null)

    const eventSource = new EventSource(`/api/sandbox/terminal/pty?${params}`)
    eventSource.onmessage = (event) => {
      if (disposed) return
      let message: { data?: unknown; error?: unknown; type?: unknown }
      try {
        message = JSON.parse(event.data) as {
          data?: unknown
          error?: unknown
          type?: unknown
        }
      } catch {
        return
      }

      if (message.type === "ready") {
        setStatus("ready")
        setError(null)
        terminal.focus()
        return
      }

      if (message.type === "data" && typeof message.data === "string") {
        const binary = atob(message.data)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i)
        }
        terminal.write(bytes)
        return
      }

      if (message.type === "error") {
        const detail =
          typeof message.error === "string"
            ? message.error
            : "Unable to connect Daytona terminal."
        setStatus("error")
        setError(detail)
        terminal.writeln(`\r\n${detail}`)
        eventSource?.close()
      }
    }
    eventSource.onerror = () => {
      if (disposed || eventSource?.readyState === EventSource.CLOSED) return
      setStatus("reconnecting")
    }

    return () => {
      unregisterCloser()
      if (inputFlushTimer) clearTimeout(inputFlushTimer)
      if (resizeTimer) clearTimeout(resizeTimer)
      flushInput()
      disposed = true
      dataDisposable.dispose()
      resizeObserver?.disconnect()
      window.removeEventListener("resize", scheduleResize)
      eventSource?.close()
      terminal.dispose()
      killTerminal()
    }
  }, [open, sandboxId, sessionVersion])

  const externalUrl =
    externalUrlState?.sandboxId === sandboxId ? externalUrlState.url : null

  const openExternalTerminal = useCallback(async () => {
    if (!sandboxId) return
    if (externalUrl) {
      window.open(externalUrl, "_blank", "noopener,noreferrer")
      return
    }

    setExternalLoading(true)
    try {
      const res = await fetch(
        `/api/sandbox/terminal/url?sandboxId=${encodeURIComponent(sandboxId)}`,
        { cache: "no-store" }
      )
      const data = (await res.json().catch(() => undefined)) as
        | { error?: unknown; url?: unknown }
        | undefined
      if (!res.ok || typeof data?.url !== "string") {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Unable to open Daytona terminal."
        )
      }
      setExternalUrlState({ sandboxId, url: data.url })
      window.open(data.url, "_blank", "noopener,noreferrer")
    } catch (err) {
      setStatus("error")
      setError(
        err instanceof Error ? err.message : "Unable to open Daytona terminal."
      )
    } finally {
      setExternalLoading(false)
    }
  }, [externalUrl, sandboxId])

  function handleResizeStart(e: ReactMouseEvent<HTMLDivElement>) {
    e.preventDefault()
    dragStartRef.current = { h: height, y: e.clientY }

    function onMove(ev: MouseEvent) {
      const ctx = dragStartRef.current
      if (!ctx) return
      const next = Math.min(
        Math.max(260, ctx.h + (ctx.y - ev.clientY)),
        Math.max(300, window.innerHeight - 180)
      )
      onHeightChange(next)
    }

    function onUp() {
      dragStartRef.current = null
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      document.body.style.removeProperty("cursor")
      document.body.style.removeProperty("user-select")
    }

    document.body.style.cursor = "row-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  if (!open || !sandboxId) return null

  const statusLabel =
    status === "ready"
      ? "Connected"
      : status === "reconnecting"
        ? "Reconnecting"
        : status === "error"
          ? "Connection issue"
          : "Connecting"

  return (
    <section
      className="absolute inset-x-0 bottom-0 z-20 flex min-h-0 flex-col overflow-hidden border-t border-border/60 bg-[#090909] text-white shadow-[0_-16px_40px_-32px_rgba(0,0,0,0.9)]"
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        onMouseDown={handleResizeStart}
        className="absolute top-0 right-0 left-0 z-10 h-2 -translate-y-1 cursor-row-resize"
      />
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-white/10 bg-[#0d0d0d] px-3">
        <span className="text-xs font-medium tracking-wide text-white/72 uppercase">
          Daytona PTY
        </span>
        <span
          className={cn(
            "size-1.5 rounded-full",
            status === "ready" && "bg-emerald-400",
            status === "reconnecting" && "bg-amber-300",
            status === "connecting" && "bg-white/45",
            status === "error" && "bg-red-400"
          )}
          aria-hidden
        />
        <span className="text-xs text-white/45">{statusLabel}</span>
        {status === "connecting" || status === "reconnecting" ? (
          <Loader2 className="size-3.5 animate-spin text-white/45" />
        ) : null}
        {error ? (
          <span className="min-w-0 truncate text-xs text-red-300/90">
            {error}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setSessionVersion((version) => version + 1)}
          aria-label="Reconnect terminal"
          title="Reconnect terminal"
          className="ml-auto grid size-7 place-items-center rounded-md text-white/52 transition-colors hover:bg-white/10 hover:text-white"
        >
          <RefreshCw className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={openExternalTerminal}
          aria-label="Open Daytona terminal in a new tab"
          title="Open Daytona terminal in a new tab"
          className="grid size-7 place-items-center rounded-md text-white/52 transition-colors hover:bg-white/10 hover:text-white"
        >
          {externalLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ExternalLink className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close terminal"
          title="Close terminal"
          className="grid size-7 place-items-center rounded-md text-white/52 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden bg-[#090909] p-2">
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden rounded-[6px] bg-[#090909] [&_.xterm-screen]:outline-none [&_.xterm-viewport]:bg-[#090909]"
        />
      </div>
    </section>
  )
}
