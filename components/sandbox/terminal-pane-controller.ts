"use client"

import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { useCallback, useEffect, useRef } from "react"

import {
  killBrowserTerminalSession,
  registerTerminalCloser,
} from "@/components/sandbox/terminal-session"
import {
  TERMINAL_INPUT_FLUSH_DELAY_MS,
  type TerminalPalette,
  type TerminalSessionState,
  type TerminalStatus,
  type TerminalWindow,
} from "@/components/sandbox/terminal-model"
import { fetchJson, postJson } from "@/lib/http/client-json"
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
} from "@/lib/daytona/terminal-params"

function isEditableElement(element: Element | null) {
  if (!element) return false
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return true
  }

  return (
    element instanceof HTMLElement &&
    (element.isContentEditable || element.getAttribute("role") === "textbox")
  )
}

export function useSandboxTerminalPaneController({
  active,
  palette,
  sandboxId,
  session,
  onStatusChange,
}: {
  active: boolean
  palette: TerminalPalette
  sandboxId: string
  session: TerminalWindow
  onStatusChange: (terminalId: string, state: TerminalSessionState) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const activeRef = useRef(active)
  const paletteRef = useRef<TerminalPalette>(palette)
  const scheduleResizeRef = useRef<(() => void) | null>(null)

  const shouldFocusTerminal = useCallback(() => {
    if (!activeRef.current) return false

    const activeElement = document.activeElement
    const terminalElement = terminalRef.current?.element
    if (!activeElement || activeElement === document.body) return true
    if (terminalElement?.contains(activeElement)) return true

    return !isEditableElement(activeElement)
  }, [])

  const focusTerminal = useCallback(() => {
    requestAnimationFrame(() => {
      if (shouldFocusTerminal()) terminalRef.current?.focus()
    })
  }, [shouldFocusTerminal])

  const focusTerminalFromPointer = useCallback(() => {
    if (!activeRef.current) return
    terminalRef.current?.focus()
  }, [])

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    paletteRef.current = palette
    if (terminalRef.current) {
      terminalRef.current.options.theme = palette
    }
  }, [palette])

  useEffect(() => {
    if (!active) return

    const frame = requestAnimationFrame(() => {
      scheduleResizeRef.current?.()
      terminalRef.current?.focus()
    })

    return () => cancelAnimationFrame(frame)
  }, [active])

  useEffect(() => {
    if (!containerRef.current) return

    const sessionSandboxId = sandboxId
    const terminalId = session.id
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
      smoothScrollDuration: 0,
      theme: paletteRef.current,
    })
    terminalRef.current = terminal
    const fitAddon = new FitAddon()
    const node = containerRef.current
    let disposed = false
    let connectedOnce = false
    let inputFlushTimer: ReturnType<typeof setTimeout> | undefined
    let reconnectAttempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let pendingInput = ""
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let socket: WebSocket | undefined
    let socketConnectionId = 0
    let socketInputReady = false
    let lastSize = { cols: 0, rows: 0 }
    const inputEncoder = new TextEncoder()

    function setTerminalState(
      status: TerminalStatus,
      error: string | null = null
    ) {
      onStatusChange(terminalId, { error, status })
    }

    function postTerminalControl(payload: Record<string, unknown>) {
      if (disposed) return Promise.resolve()
      return postJson<void>(
        "/api/sandbox/terminal/ws",
        {
          sandboxId: sessionSandboxId,
          terminalId,
          ...payload,
        },
        {},
        {
          fallbackError: "Terminal request failed.",
        }
      )
    }

    function flushInput() {
      if (!pendingInput || disposed) return
      if (
        !socketInputReady ||
        !socket ||
        socket.readyState !== WebSocket.OPEN
      ) {
        return
      }

      const data = pendingInput
      pendingInput = ""
      try {
        socket.send(inputEncoder.encode(data))
      } catch (error) {
        pendingInput = data + pendingInput
        setTerminalState(
          "error",
          error instanceof Error ? error.message : "Terminal input failed."
        )
      }
    }

    function sendResize() {
      if (disposed || !activeRef.current) return
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
      void postTerminalControl({ action: "resize", cols, rows }).catch(() => {
        // The initial resize can race the PTY creation; the WebSocket prep
        // request also carries the first size, so missing this one is harmless.
      })
    }

    function scheduleResize() {
      if (!activeRef.current) return
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(sendResize, 50)
    }
    scheduleResizeRef.current = scheduleResize

    function killTerminal() {
      void killBrowserTerminalSession(sessionSandboxId, terminalId)
    }

    const unregisterCloser = registerTerminalCloser(
      sessionSandboxId,
      terminalId,
      killTerminal
    )

    function queueInput(data: string) {
      pendingInput += data
      if (inputFlushTimer) return
      inputFlushTimer = setTimeout(() => {
        inputFlushTimer = undefined
        flushInput()
      }, TERMINAL_INPUT_FLUSH_DELAY_MS)
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
    focusTerminal()
    resizeObserver?.observe(node)
    window.addEventListener("resize", scheduleResize)

    try {
      fitAddon.fit()
      lastSize = { cols: terminal.cols, rows: terminal.rows }
    } catch {
      lastSize = {
        cols: TERMINAL_DEFAULT_COLS,
        rows: TERMINAL_DEFAULT_ROWS,
      }
    }

    setTerminalState("connecting")

    function terminalWebSocketParams() {
      return new URLSearchParams({
        cols: String(lastSize.cols || TERMINAL_DEFAULT_COLS),
        rows: String(lastSize.rows || TERMINAL_DEFAULT_ROWS),
        sandboxId: sessionSandboxId,
        terminalId,
      })
    }

    async function prepareTerminalWebSocket() {
      const data = await fetchJson<{
        error?: unknown
        protocol?: unknown
        wsUrl?: unknown
      }>(
        `/api/sandbox/terminal/ws?${terminalWebSocketParams()}`,
        {},
        {
          fallbackError: "Unable to prepare Daytona terminal.",
        }
      )

      if (typeof data?.wsUrl !== "string" || !data.wsUrl.trim()) {
        throw new Error("Daytona terminal WebSocket URL missing.")
      }

      return {
        protocol: typeof data.protocol === "string" ? data.protocol : undefined,
        wsUrl: data.wsUrl,
      }
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer) return
      setTerminalState("reconnecting")
      const delay = Math.min(5_000, 250 * 2 ** reconnectAttempt)
      reconnectAttempt += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined
        void connectSocket()
      }, delay)
    }

    function handleSocketError(error: string) {
      if (disposed) return
      setTerminalState("error", error)
      terminal.writeln(`\r\n${error}`)
    }

    async function socketBytes(data: unknown) {
      if (data instanceof ArrayBuffer) return new Uint8Array(data)
      if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      }
      if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
      return null
    }

    async function handleSocketMessage(event: MessageEvent) {
      if (disposed) return

      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data) as {
            error?: unknown
            status?: unknown
            type?: unknown
          }
          if (message.type === "control") {
            if (message.status === "connected") {
              connectedOnce = true
              reconnectAttempt = 0
              socketInputReady = true
              setTerminalState("ready")
              flushInput()
              focusTerminal()
              return
            }
            if (message.status === "error") {
              handleSocketError(
                typeof message.error === "string"
                  ? message.error
                  : "Unable to connect Daytona terminal."
              )
              socket?.close()
              return
            }
          }
        } catch {
          // Non-control strings are PTY output.
        }

        terminal.write(event.data)
        return
      }

      const bytes = await socketBytes(event.data)
      if (bytes?.byteLength) terminal.write(bytes)
    }

    async function connectSocket() {
      const connectionId = socketConnectionId + 1
      socketConnectionId = connectionId
      socketInputReady = false

      try {
        const { protocol, wsUrl } = await prepareTerminalWebSocket()
        if (disposed || connectionId !== socketConnectionId) return

        socket?.close()
        socket = protocol
          ? new WebSocket(wsUrl, protocol)
          : new WebSocket(wsUrl)
        socket.binaryType = "arraybuffer"
        socket.onmessage = (event) => {
          void handleSocketMessage(event)
        }
        socket.onerror = () => {
          if (!disposed) setTerminalState("reconnecting")
        }
        socket.onclose = (event) => {
          if (disposed || connectionId !== socketConnectionId) return
          socketInputReady = false
          socket = undefined

          if (!connectedOnce) {
            handleSocketError(
              event.reason || "Unable to connect Daytona terminal."
            )
            return
          }

          scheduleReconnect()
        }
      } catch (error) {
        if (disposed || connectionId !== socketConnectionId) return

        const detail =
          error instanceof Error
            ? error.message
            : "Unable to connect Daytona terminal."
        if (connectedOnce) {
          setTerminalState("reconnecting")
          scheduleReconnect()
        } else {
          handleSocketError(detail)
        }
      }
    }

    void connectSocket()

    return () => {
      unregisterCloser()
      if (scheduleResizeRef.current === scheduleResize) {
        scheduleResizeRef.current = null
      }
      if (inputFlushTimer) {
        clearTimeout(inputFlushTimer)
        inputFlushTimer = undefined
      }
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (resizeTimer) clearTimeout(resizeTimer)
      flushInput()
      disposed = true
      dataDisposable.dispose()
      resizeObserver?.disconnect()
      window.removeEventListener("resize", scheduleResize)
      socket?.close()
      terminal.dispose()
      if (terminalRef.current === terminal) terminalRef.current = null
    }
    // palette is applied via a separate effect; we intentionally don't recreate
    // the terminal when the theme changes.
  }, [focusTerminal, onStatusChange, sandboxId, session.id, session.restartKey])

  return {
    containerRef,
    focusTerminalFromPointer,
  }
}
