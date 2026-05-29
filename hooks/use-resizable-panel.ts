"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type ResizeEdge = "left" | "right"

interface UseResizablePanelOptions {
  /** localStorage key used to persist the chosen width across sessions. */
  storageKey: string
  /** Width (px) used before any user adjustment or persisted value. */
  defaultWidth: number
  /** Smallest width (px) the panel may be dragged to. */
  minWidth: number
  /** Largest width (px) the panel may be dragged to. */
  maxWidth: number
  /** Edge the drag handle sits on; determines the drag direction. */
  edge: ResizeEdge
  /**
   * Minimum horizontal space (px) to leave for the rest of the viewport so a
   * panel can never be dragged wide enough to crowd out the main content.
   */
  viewportReserve?: number
  /**
   * When false (e.g. mobile full-screen mode) resizing, persistence, and the
   * viewport re-clamp are all inert, so a narrow viewport never overwrites the
   * persisted desktop width. The hook still hydrates so the saved width is
   * ready the moment it is re-enabled.
   */
  enabled?: boolean
}

interface UseResizablePanelResult {
  width: number
  resizing: boolean
  onResizeStart: (event: React.MouseEvent) => void
  resetWidth: () => void
}

/**
 * Horizontal panel resizing with clamping and per-key persistence. Drag logic
 * mirrors the terminal's vertical resizer (window-level mouse listeners) but is
 * shared so every sidebar behaves identically. Width is clamped to
 * [minWidth, maxWidth] always, and additionally to whatever the viewport can
 * spare while a drag or window resize is happening.
 */
export function useResizablePanel({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  edge,
  viewportReserve = 360,
  enabled = true,
}: UseResizablePanelOptions): UseResizablePanelResult {
  const clampToBounds = useCallback(
    (value: number) => Math.min(Math.max(value, minWidth), maxWidth),
    [minWidth, maxWidth]
  )

  // Bounds plus a viewport guard. Applied only during live drags and desktop
  // window resizes — never to hydration — so a small screen can't shrink the
  // stored preference.
  const clampToViewport = useCallback(
    (value: number) => {
      const bounded = clampToBounds(value)
      if (typeof window === "undefined") return bounded
      const viewportMax = Math.max(
        minWidth,
        window.innerWidth - viewportReserve
      )
      return Math.min(bounded, viewportMax)
    },
    [clampToBounds, minWidth, viewportReserve]
  )

  const [width, setWidth] = useState(defaultWidth)
  const [resizing, setResizing] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const hydratedRef = useRef(false)

  // Hydrate once from storage (bounds only) to avoid SSR markup mismatches.
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    const stored = window.localStorage.getItem(storageKey)
    if (stored === null) return
    const parsed = Number.parseFloat(stored)
    if (Number.isFinite(parsed)) setWidth(clampToBounds(parsed))
  }, [storageKey, clampToBounds])

  // Persist whenever the width settles. Skipped while disabled so mobile never
  // overwrites the desktop preference.
  useEffect(() => {
    if (!enabled) return
    window.localStorage.setItem(storageKey, String(Math.round(width)))
  }, [enabled, storageKey, width])

  // Re-clamp if the viewport shrinks so a wide panel can't trap the content.
  useEffect(() => {
    if (!enabled) return
    const onResize = () => setWidth((current) => clampToViewport(current))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [enabled, clampToViewport])

  const onResizeStart = useCallback(
    (event: React.MouseEvent) => {
      if (!enabled) return
      event.preventDefault()
      dragRef.current = { startX: event.clientX, startWidth: width }
      setResizing(true)

      const onMove = (ev: MouseEvent) => {
        const ctx = dragRef.current
        if (!ctx) return
        const delta = ev.clientX - ctx.startX
        const next =
          edge === "right" ? ctx.startWidth + delta : ctx.startWidth - delta
        setWidth(clampToViewport(next))
      }

      const onUp = () => {
        dragRef.current = null
        setResizing(false)
        window.removeEventListener("mousemove", onMove)
        window.removeEventListener("mouseup", onUp)
        document.body.style.removeProperty("cursor")
        document.body.style.removeProperty("user-select")
      }

      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      window.addEventListener("mousemove", onMove)
      window.addEventListener("mouseup", onUp)
    },
    [enabled, width, edge, clampToViewport]
  )

  const resetWidth = useCallback(() => {
    setWidth(clampToViewport(defaultWidth))
  }, [clampToViewport, defaultWidth])

  return { width, resizing, onResizeStart, resetWidth }
}
