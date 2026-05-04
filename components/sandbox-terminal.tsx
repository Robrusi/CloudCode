"use client"

import { Terminal, X } from "lucide-react"
import { useTheme } from "next-themes"
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react"
import type { FitAddon } from "@xterm/addon-fit"
import type { Terminal as XTermTerminal } from "@xterm/xterm"

import { cn } from "@/lib/utils"

const TERMINAL_BUFFER_LIMIT = 2_000

type TerminalAssetModules = {
  FitAddon: typeof import("@xterm/addon-fit").FitAddon
  Terminal: typeof import("@xterm/xterm").Terminal
}

type BrowserTerminalStatus = "connecting" | "ready" | "closed"

type BrowserTerminalEvent =
  | { kind: "chunk"; data: string | Uint8Array }
  | { error?: string; kind: "status"; status: BrowserTerminalStatus }

type BrowserTerminalSession = {
  buffered: Array<string | Uint8Array>
  error?: string
  listeners: Set<(event: BrowserTerminalEvent) => void>
  queuedInput: Uint8Array[]
  size: { cols: number; rows: number }
  socket: WebSocket | null
  status: BrowserTerminalStatus
  url?: string
  urlPromise?: Promise<string>
}

let terminalAssetPromise: Promise<TerminalAssetModules> | null = null
const browserTerminalSessions = new Map<string, BrowserTerminalSession>()
const terminalUrlCache = new Map<string, string>()
const terminalUrlPromises = new Map<string, Promise<string>>()

function preloadTerminalAssets() {
  terminalAssetPromise ??= Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
  ]).then(([xterm, fit]) => ({
    FitAddon: fit.FitAddon,
    Terminal: xterm.Terminal,
  }))
  return terminalAssetPromise
}

function getTerminalUrl(sandboxId: string) {
  const cached = terminalUrlCache.get(sandboxId)
  if (cached) return Promise.resolve(cached)

  const existing = terminalUrlPromises.get(sandboxId)
  if (existing) return existing

  const promise = fetch(
    `/api/sandbox/terminal/url?sandboxId=${encodeURIComponent(sandboxId)}`,
    { cache: "no-store" }
  )
    .then(async (res) => {
      const data = (await res.json()) as { error?: string; url?: string }
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Failed to start terminal.")
      }
      terminalUrlCache.set(sandboxId, data.url)
      return data.url
    })
    .finally(() => {
      terminalUrlPromises.delete(sandboxId)
    })

  terminalUrlPromises.set(sandboxId, promise)
  return promise
}

function createBrowserTerminalSession(): BrowserTerminalSession {
  return {
    buffered: [],
    listeners: new Set(),
    queuedInput: [],
    size: { cols: 100, rows: 24 },
    socket: null,
    status: "connecting",
  }
}

function emitBrowserTerminalEvent(
  session: BrowserTerminalSession,
  event: BrowserTerminalEvent
) {
  for (const listener of session.listeners) listener(event)
}

function setBrowserTerminalStatus(
  session: BrowserTerminalSession,
  status: BrowserTerminalStatus,
  error?: string
) {
  session.status = status
  session.error = error
  emitBrowserTerminalEvent(session, { error, kind: "status", status })
}

function bufferBrowserTerminalChunk(
  session: BrowserTerminalSession,
  data: string | Uint8Array
) {
  session.buffered.push(data)
  if (session.buffered.length > TERMINAL_BUFFER_LIMIT) {
    session.buffered.splice(0, session.buffered.length - TERMINAL_BUFFER_LIMIT)
  }
  emitBrowserTerminalEvent(session, { data, kind: "chunk" })
}

function ensureBrowserTerminalSession(sandboxId: string) {
  let session = browserTerminalSessions.get(sandboxId)
  if (!session) {
    session = createBrowserTerminalSession()
    browserTerminalSessions.set(sandboxId, session)
  }

  if (
    session.socket?.readyState === WebSocket.OPEN ||
    session.socket?.readyState === WebSocket.CONNECTING
  ) {
    return session
  }
  if (session.status === "connecting" && session.urlPromise) {
    return session
  }

  session.socket = null
  session.status = "connecting"
  session.error = undefined

  session.urlPromise = getTerminalUrl(sandboxId)
    .then((url) => {
      session.url = url
      const socket = new WebSocket(url)
      socket.binaryType = "arraybuffer"
      session.socket = socket

      socket.onopen = () => {
        setBrowserTerminalStatus(session, "ready")
        socket.send(JSON.stringify({ type: "resize", ...session.size }))
        for (const input of session.queuedInput) socket.send(input)
        session.queuedInput = []
      }

      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          bufferBrowserTerminalChunk(session, event.data)
          return
        }
        bufferBrowserTerminalChunk(
          session,
          new Uint8Array(event.data as ArrayBuffer)
        )
      }

      socket.onerror = () => {
        setBrowserTerminalStatus(
          session,
          "closed",
          "Terminal connection failed."
        )
      }

      socket.onclose = () => {
        if (session.socket === socket) session.socket = null
        setBrowserTerminalStatus(session, "closed", session.error)
      }

      return url
    })
    .catch((error) => {
      setBrowserTerminalStatus(
        session,
        "closed",
        error instanceof Error ? error.message : "Failed to open terminal."
      )
      session.urlPromise = undefined
      return ""
    })

  emitBrowserTerminalEvent(session, { kind: "status", status: "connecting" })
  return session
}

export function warmBrowserTerminal(sandboxId: string | null | undefined) {
  if (!sandboxId) return
  void preloadTerminalAssets()
  ensureBrowserTerminalSession(sandboxId)
}

function sendBrowserTerminalInput(sandboxId: string, data: Uint8Array) {
  const session = ensureBrowserTerminalSession(sandboxId)
  const socket = session.socket
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(data)
  } else {
    session.queuedInput.push(data)
  }
}

function resizeBrowserTerminal(
  sandboxId: string,
  size: { cols: number; rows: number }
) {
  const session = ensureBrowserTerminalSession(sandboxId)
  session.size = size
  const socket = session.socket
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "resize", ...size }))
  }
}

export function closeBrowserTerminalSession(
  sandboxId: string | null | undefined
) {
  if (!sandboxId) return
  const session = browserTerminalSessions.get(sandboxId)
  session?.socket?.close()
  browserTerminalSessions.delete(sandboxId)
  terminalUrlCache.delete(sandboxId)
  terminalUrlPromises.delete(sandboxId)
}

const TERMINAL_MIN_HEIGHT = 140
const TERMINAL_MAX_HEIGHT_RATIO = 0.85

const TERMINAL_THEMES = {
  dark: {
    background: "#09090b",
    cursor: "#fafafa",
    cursorAccent: "#09090b",
    foreground: "#e4e4e7",
    selectionBackground: "#27272a",
  },
  light: {
    background: "#fafafa",
    cursor: "#18181b",
    cursorAccent: "#fafafa",
    foreground: "#27272a",
    selectionBackground: "#e4e4e7",
  },
} as const

export function SandboxTerminalPanel({
  height,
  onClose,
  onHeightChange,
  open,
  sandboxId,
}: {
  height: number
  onClose: () => void
  onHeightChange: (next: number) => void
  open: boolean
  sandboxId: string | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTermTerminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<"connecting" | "ready" | "closed">(
    "connecting"
  )
  const [error, setError] = useState("")
  const [resizing, setResizing] = useState(false)
  const [rawInput, setRawInput] = useState(false)
  const rawInputRef = useRef(false)
  const { resolvedTheme } = useTheme()
  const themeKey: "light" | "dark" =
    resolvedTheme === "light" ? "light" : "dark"

  useEffect(() => {
    rawInputRef.current = rawInput
  }, [rawInput])

  useEffect(() => {
    if (!open || !sandboxId) return

    const activeSandboxId = sandboxId
    let cancelled = false
    let resizeObserver: ResizeObserver | undefined
    let inputDisposable: { dispose: () => void } | undefined
    let unsubscribe: (() => void) | undefined
    let resizeTimer: number | undefined
    let directMode = false
    let localLine = ""
    let localCursor = 0
    let inputHistory: string[] = []
    let historyIndex: number | null = null
    let suppressRemoteEcho = ""
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    function writeTerminalChunk(data: string | Uint8Array) {
      terminalRef.current?.write(data)
    }

    function stripSuppressedEcho(data: string | Uint8Array) {
      if (!suppressRemoteEcho) return data

      const text = typeof data === "string" ? data : decoder.decode(data)
      let next = text

      while (suppressRemoteEcho && next) {
        if (next.startsWith(suppressRemoteEcho)) {
          next = next.slice(suppressRemoteEcho.length)
          suppressRemoteEcho = ""
          break
        }
        if (suppressRemoteEcho.startsWith(next)) {
          suppressRemoteEcho = suppressRemoteEcho.slice(next.length)
          return ""
        }
        if (next[0] !== suppressRemoteEcho[0]) {
          suppressRemoteEcho = ""
          break
        }
        next = next.slice(1)
        suppressRemoteEcho = suppressRemoteEcho.slice(1)
      }

      return next
    }

    function updateTerminalMode(data: string | Uint8Array) {
      const text = typeof data === "string" ? data : decoder.decode(data)
      if (text.includes("\x1b[?1049h")) directMode = true
      if (text.includes("\x1b[?1049l")) directMode = false
    }

    function sendResize() {
      const terminal = terminalRef.current
      const fit = fitRef.current
      if (!terminal || !fit) return
      try {
        fit.fit()
      } catch {
        return
      }
      resizeBrowserTerminal(activeSandboxId, {
        cols: terminal.cols,
        rows: terminal.rows,
      })
    }

    function scheduleResize() {
      if (resizeTimer) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(sendResize, 30)
    }

    function localChars() {
      return Array.from(localLine)
    }

    function setLocalLine(next: string, cursor = Array.from(next).length) {
      const oldCursor = localCursor
      localLine = next
      localCursor = Math.max(0, Math.min(cursor, Array.from(next).length))

      let repaint = "\x1b[?25l"
      if (oldCursor > 0) repaint += `\x1b[${oldCursor}D`
      repaint += `\x1b[0K${localLine}`
      const distanceFromEnd = Array.from(localLine).length - localCursor
      if (distanceFromEnd > 0) {
        repaint += `\x1b[${distanceFromEnd}D`
      }
      terminalRef.current?.write(`${repaint}\x1b[?25h`)
    }

    function insertLocalText(text: string) {
      if (!text) return
      const chars = localChars()
      const next = [
        ...chars.slice(0, localCursor),
        ...Array.from(text),
        ...chars.slice(localCursor),
      ].join("")
      setLocalLine(next, localCursor + Array.from(text).length)
    }

    function moveLocalCursor(delta: number) {
      const next = Math.max(
        0,
        Math.min(localCursor + delta, localChars().length)
      )
      const distance = next - localCursor
      if (distance > 0) terminalRef.current?.write(`\x1b[${distance}C`)
      if (distance < 0)
        terminalRef.current?.write(`\x1b[${Math.abs(distance)}D`)
      localCursor = next
    }

    function replaceFromHistory(direction: -1 | 1) {
      if (inputHistory.length === 0) return
      const nextIndex =
        historyIndex === null
          ? direction < 0
            ? inputHistory.length - 1
            : null
          : historyIndex + direction

      if (nextIndex === null || nextIndex >= inputHistory.length) {
        historyIndex = null
        setLocalLine("")
        return
      }
      if (nextIndex < 0) return

      historyIndex = nextIndex
      setLocalLine(inputHistory[nextIndex])
    }

    function handleEscapeSequence(sequence: string) {
      const final = sequence.at(-1)
      if (final === "D") {
        moveLocalCursor(-1)
        return true
      }
      if (final === "C") {
        moveLocalCursor(1)
        return true
      }
      if (final === "A") {
        replaceFromHistory(-1)
        return true
      }
      if (final === "B") {
        replaceFromHistory(1)
        return true
      }
      if (final === "H") {
        moveLocalCursor(-localCursor)
        return true
      }
      if (final === "F") {
        moveLocalCursor(localChars().length - localCursor)
        return true
      }
      if (sequence === "\x1b[3~" && localCursor < localChars().length) {
        const chars = localChars()
        chars.splice(localCursor, 1)
        setLocalLine(chars.join(""), localCursor)
        return true
      }
      return false
    }

    function sendInput(data: string) {
      if (directMode || rawInputRef.current) {
        sendBrowserTerminalInput(activeSandboxId, encoder.encode(data))
        return
      }

      const input = data.replace(/\x1b\[200~([\s\S]*?)\x1b\[201~/g, "$1")
      let offset = 0
      while (offset < input.length) {
        if (input[offset] === "\x1b") {
          const sequence =
            input
              .slice(offset)
              .match(/^\x1b(?:O[A-DHF]|\[[0-9;]*[~A-DHF])/)?.[0] ?? "\x1b"
          handleEscapeSequence(sequence)
          offset += sequence.length
          continue
        }

        const char = Array.from(input.slice(offset))[0]
        offset += char.length

        if (char === "\r" || char === "\n") {
          terminalRef.current?.write("\r\n")
          suppressRemoteEcho += `${localLine}\r\n`
          const command = localLine.trim()
          if (command && inputHistory[inputHistory.length - 1] !== localLine) {
            inputHistory = [...inputHistory.slice(-99), localLine]
          }
          historyIndex = null
          sendBrowserTerminalInput(
            activeSandboxId,
            encoder.encode(`${localLine}\r`)
          )
          localLine = ""
          localCursor = 0
          continue
        }

        if (char === "\u007f" || char === "\b") {
          if (!localLine || localCursor === 0) continue
          const chars = localChars()
          chars.splice(localCursor - 1, 1)
          setLocalLine(chars.join(""), localCursor - 1)
          continue
        }

        if (char === "\x03") {
          terminalRef.current?.write("^C\r\n")
          suppressRemoteEcho += "^C\r\n"
          localLine = ""
          localCursor = 0
          historyIndex = null
          sendBrowserTerminalInput(activeSandboxId, encoder.encode(char))
          continue
        }

        if (/[\u0000-\u001f\u007f]/.test(char)) {
          if (!localLine) {
            sendBrowserTerminalInput(activeSandboxId, encoder.encode(char))
          }
          continue
        }

        historyIndex = null
        insertLocalText(char)
      }
    }

    async function boot() {
      const session = ensureBrowserTerminalSession(activeSandboxId)
      const { FitAddon: BrowserFitAddon, Terminal: BrowserTerminal } =
        await preloadTerminalAssets()
      if (cancelled || !containerRef.current) return

      setStatus(session.status)
      setError(session.error ?? "")

      const terminal = new BrowserTerminal({
        allowProposedApi: false,
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily:
          'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
        fontSize: 13,
        letterSpacing: 0,
        lineHeight: 1.35,
        rightClickSelectsWord: true,
        scrollback: 10000,
        theme: TERMINAL_THEMES[themeKey],
      })
      const fit = new BrowserFitAddon()
      terminal.loadAddon(fit)
      terminal.open(containerRef.current)

      // Two ticks: open paints the canvas, then we measure once layout settles.
      requestAnimationFrame(() => {
        try {
          fit.fit()
        } catch {
          // ignore
        }
      })

      terminalRef.current = terminal
      fitRef.current = fit
      terminal.focus()

      for (const chunk of session.buffered) writeTerminalChunk(chunk)
      unsubscribe = () => session.listeners.delete(handleTerminalEvent)
      session.listeners.add(handleTerminalEvent)

      function handleTerminalEvent(event: BrowserTerminalEvent) {
        if (cancelled) return
        if (event.kind === "chunk") {
          updateTerminalMode(event.data)
          const output = stripSuppressedEcho(event.data)
          if (output) writeTerminalChunk(output)
          return
        }
        setStatus(event.status)
        setError(event.error ?? "")
      }

      inputDisposable = terminal.onData(sendInput)
      resizeObserver = new ResizeObserver(scheduleResize)
      resizeObserver.observe(containerRef.current)
      sendResize()
    }

    boot().catch((err) => {
      if (cancelled) return
      setStatus("closed")
      setError(err instanceof Error ? err.message : "Failed to open terminal.")
    })

    return () => {
      cancelled = true
      if (resizeTimer) window.clearTimeout(resizeTimer)
      resizeObserver?.disconnect()
      inputDisposable?.dispose()
      unsubscribe?.()
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
    // themeKey intentionally excluded — theme changes are applied to the
    // live terminal in the effect below without re-initialising.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sandboxId])

  // Reactively update the live terminal's theme when the app theme changes.
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = TERMINAL_THEMES[themeKey]
  }, [themeKey])

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = height
    setResizing(true)

    function handleMove(moveEvent: PointerEvent) {
      const max = Math.max(
        TERMINAL_MIN_HEIGHT,
        Math.floor(window.innerHeight * TERMINAL_MAX_HEIGHT_RATIO)
      )
      const next = Math.min(
        max,
        Math.max(
          TERMINAL_MIN_HEIGHT,
          startHeight + (startY - moveEvent.clientY)
        )
      )
      onHeightChange(next)
    }

    function handleUp() {
      setResizing(false)
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
      window.removeEventListener("pointercancel", handleUp)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", handleUp)
  }

  if (!open) return null

  const dotColor =
    status === "ready"
      ? "bg-emerald-400"
      : status === "connecting"
        ? "bg-amber-400 animate-pulse"
        : "bg-zinc-500"

  return (
    <section
      className="flex shrink-0 flex-col border-t border-border/60 bg-zinc-50 text-zinc-700 dark:bg-[#09090b] dark:text-zinc-200"
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        onPointerDown={startResize}
        className={cn(
          "group relative -mt-px h-1.5 shrink-0 cursor-row-resize select-none",
          "before:absolute before:inset-x-0 before:-top-1 before:h-3 before:content-['']",
          "after:absolute after:inset-x-0 after:top-1/2 after:h-px after:-translate-y-1/2 after:bg-border/60 after:transition-colors",
          "hover:after:bg-foreground/40",
          resizing && "after:bg-foreground/60"
        )}
      />
      <div className="flex h-8 shrink-0 items-center gap-2 px-3 text-[11px] tracking-wide text-muted-foreground">
        <span
          className={`size-1.5 rounded-full ${dotColor}`}
          aria-hidden="true"
        />
        <span>terminal</span>
        {error ? (
          <span className="truncate text-rose-500 dark:text-rose-400/80">
            — {error}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setRawInput((enabled) => !enabled)
            window.setTimeout(() => terminalRef.current?.focus(), 0)
          }}
          aria-pressed={rawInput}
          aria-label={
            rawInput ? "Use instant terminal input" : "Use raw terminal input"
          }
          title={
            rawInput
              ? "Raw input on. Click for instant input."
              : "Instant input on. Click for raw input."
          }
          className={cn(
            "ml-auto inline-flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors",
            rawInput
              ? "bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
              : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          )}
        >
          <Terminal className="size-3.5" />
          <span>{rawInput ? "raw" : "instant"}</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close terminal"
          title="Close terminal"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div
        ref={containerRef}
        onClick={() => terminalRef.current?.focus()}
        className="min-h-0 flex-1 cursor-text px-3 pb-2"
      />
    </section>
  )
}
