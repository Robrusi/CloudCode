"use client"

import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { CircleDot, Loader2, OctagonX, RefreshCw, X } from "lucide-react"
import { useTheme } from "next-themes"
import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { registerTerminalCloser } from "@/components/sandbox-terminal-session"
import { cn } from "@/lib/utils"

type TerminalStatus = "connecting" | "ready" | "reconnecting" | "error"

type TerminalPalette = {
  background: string
  black: string
  blue: string
  brightBlack: string
  brightBlue: string
  brightCyan: string
  brightGreen: string
  brightMagenta: string
  brightRed: string
  brightWhite: string
  brightYellow: string
  cursor: string
  cursorAccent: string
  cyan: string
  foreground: string
  green: string
  magenta: string
  red: string
  selectionBackground: string
  selectionForeground: string
  white: string
  yellow: string
}

const darkPalette: TerminalPalette = {
  background: "#0b0d10",
  black: "#15181d",
  blue: "#7aa2f7",
  brightBlack: "#5b6172",
  brightBlue: "#9ab8ff",
  brightCyan: "#7dd3fc",
  brightGreen: "#9ee6a3",
  brightMagenta: "#d8b4fe",
  brightRed: "#ffa39e",
  brightWhite: "#ffffff",
  brightYellow: "#fbd38d",
  cursor: "#e6e8eb",
  cursorAccent: "#0b0d10",
  cyan: "#67e8f9",
  foreground: "#e6e8eb",
  green: "#73d13d",
  magenta: "#c084fc",
  red: "#ff7373",
  selectionBackground: "rgba(122, 162, 247, 0.28)",
  selectionForeground: "#ffffff",
  white: "#d7d7d7",
  yellow: "#f4bf75",
}

const lightPalette: TerminalPalette = {
  background: "#fbfbfa",
  black: "#1f2328",
  blue: "#0969da",
  brightBlack: "#6e7781",
  brightBlue: "#218bff",
  brightCyan: "#179299",
  brightGreen: "#1a7f37",
  brightMagenta: "#a475f9",
  brightRed: "#cf222e",
  brightWhite: "#1f2328",
  brightYellow: "#9a6700",
  cursor: "#1f2328",
  cursorAccent: "#fbfbfa",
  cyan: "#0e7490",
  foreground: "#1f2328",
  green: "#1f883d",
  magenta: "#8250df",
  red: "#d1242f",
  selectionBackground: "rgba(9, 105, 218, 0.18)",
  selectionForeground: "#1f2328",
  white: "#57606a",
  yellow: "#bf8700",
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
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<TerminalStatus>("connecting")
  const [sessionVersion, setSessionVersion] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const dragStartRef = useRef<{ h: number; y: number } | null>(null)

  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== "light"
  const palette = useMemo<TerminalPalette>(
    () => (isDark ? darkPalette : lightPalette),
    [isDark]
  )

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = palette
    }
  }, [palette])

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
      cursorStyle: "bar",
      cursorWidth: 2,
      fontFamily:
        '"JetBrains Mono", "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
      fontSize: 13,
      fontWeight: "400",
      fontWeightBold: "600",
      letterSpacing: 0.2,
      lineHeight: 1.35,
      macOptionIsMeta: true,
      minimumContrastRatio: 4,
      scrollback: 10_000,
      smoothScrollDuration: 80,
      theme: palette,
    })
    terminalRef.current = terminal
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

    function queueInput(data: string) {
      pendingInput += data
      if (inputFlushTimer) return
      inputFlushTimer = setTimeout(() => {
        inputFlushTimer = undefined
        flushInput()
      }, 10)
    }

    const dataDisposable = terminal.onData(queueInput)

    // xterm.js doesn't translate Option/Cmd + Arrow/Backspace to readline word/line edits.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true
      const { altKey, ctrlKey, metaKey, shiftKey } = event

      if (altKey && !ctrlKey && !metaKey) {
        let seq: string | undefined
        if (event.key === "ArrowLeft") seq = "\x1bb"
        else if (event.key === "ArrowRight") seq = "\x1bf"
        else if (event.key === "Backspace") seq = "\x1b\x7f"
        else if (event.key === "Delete") seq = "\x1bd"
        if (seq) {
          event.preventDefault()
          queueInput(seq)
          return false
        }
      }

      if (metaKey && !ctrlKey && !altKey && !shiftKey) {
        let seq: string | undefined
        if (event.key === "ArrowLeft") seq = "\x01"
        else if (event.key === "ArrowRight") seq = "\x05"
        else if (event.key === "Backspace") seq = "\x15"
        else if (event.key === "Delete") seq = "\x0b"
        if (seq) {
          event.preventDefault()
          queueInput(seq)
          return false
        }
      }

      return true
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
      if (terminalRef.current === terminal) terminalRef.current = null
      killTerminal()
    }
    // palette is applied via a separate effect; we intentionally don't recreate
    // the terminal when the theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sandboxId, sessionVersion])

  function handleResizeStart(e: ReactMouseEvent<HTMLButtonElement>) {
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
          ? (error ?? "Connection issue")
          : "Connecting"

  const surfaceBg = palette.background

  return (
    <section
      className="absolute inset-x-0 bottom-0 z-20 flex min-h-0 flex-col overflow-hidden border-t border-border/70"
      style={{ height, background: surfaceBg, color: palette.foreground }}
    >
      <button
        type="button"
        aria-label="Resize terminal"
        onMouseDown={handleResizeStart}
        className="group absolute top-0 right-0 left-0 z-30 h-2 -translate-y-1 cursor-row-resize border-0 bg-transparent p-0"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 right-0 left-0 h-px bg-border/50 transition-colors group-hover:bg-primary/40"
        />
      </button>
      <div
        className="absolute top-2 right-2 z-20 flex items-center gap-1"
        aria-live="polite"
      >
        <span
          className={cn(
            "pointer-events-none inline-flex items-center gap-1.5 px-1.5 text-xs font-medium",
            status === "error" ? "text-red-500/90" : "text-muted-foreground"
          )}
          title={error ?? undefined}
        >
          {status === "ready" ? (
            <CircleDot className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : status === "error" ? (
            <OctagonX className="size-3.5" />
          ) : (
            <Loader2 className="size-3.5 animate-spin" />
          )}
          <span>{statusLabel}</span>
        </span>
        <button
          type="button"
          onClick={() => setSessionVersion((v) => v + 1)}
          aria-label="Reconnect terminal"
          title="Reconnect terminal"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close terminal"
          title="Close terminal"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-hidden px-3 pt-3 pb-1"
        style={{ background: surfaceBg }}
      >
        <div
          ref={containerRef}
          className="h-full w-full overflow-hidden [&_.xterm]:!bg-transparent [&_.xterm-screen]:outline-none [&_.xterm-viewport]:!bg-transparent"
          style={{ background: surfaceBg }}
        />
      </div>
    </section>
  )
}
