"use client"

import { useCallback, useLayoutEffect, useRef } from "react"

/**
 * Grows a textarea to fit its content instead of scrolling. On every value
 * change (and on width changes that rewrap the text) the field is reset to
 * zero height then sized to its `scrollHeight`, so it expands and contracts
 * with the text. Keep the textarea on a scrollable ancestor and pair it with
 * `overflow-hidden`; the field itself never scrolls. A CSS `min-height` still
 * wins, so callers can hold a resting multi-line height.
 */
export function useAutoGrowTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useLayoutEffect(() => {
    resize()
  }, [resize, value])

  useLayoutEffect(() => {
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [resize])

  return ref
}
