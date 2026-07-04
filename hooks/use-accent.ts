"use client"

import { useCallback, useEffect, useState } from "react"

import {
  ACCENT_ATTRIBUTE,
  ACCENT_COLOR_STORAGE_KEY,
  ACCENT_STORAGE_KEY,
  contrastForeground,
  CUSTOM_ACCENT,
  DEFAULT_ACCENT,
  resolveAccent,
  resolveCustomColor,
} from "@/lib/theme/accent"

/**
 * Reflects the selected accent onto the <html> element so the CSS rules in
 * globals.css (or, for the custom accent, inline variables) take effect.
 * Preset accents are driven purely by the `data-accent` attribute; the custom
 * accent additionally sets `--accent-solid` / `--accent-solid-foreground`
 * inline. Clearing the inline vars for presets lets their CSS rules win again.
 */
function applyAccent(accent: string, customColor: string) {
  const root = document.documentElement
  if (accent === DEFAULT_ACCENT) {
    root.removeAttribute(ACCENT_ATTRIBUTE)
  } else {
    root.setAttribute(ACCENT_ATTRIBUTE, accent)
  }
  if (accent === CUSTOM_ACCENT) {
    root.style.setProperty("--accent-solid", customColor)
    root.style.setProperty(
      "--accent-solid-foreground",
      contrastForeground(customColor)
    )
  } else {
    root.style.removeProperty("--accent-solid")
    root.style.removeProperty("--accent-solid-foreground")
  }
}

/**
 * Reads and updates the selected accent theme, which recolours the primary
 * ("solid") buttons, sliders, and toggles. The accent id and any custom colour
 * are persisted to localStorage and mirrored onto the <html> element.
 *
 * A pre-hydration script in app/layout.tsx applies the stored accent before
 * first paint; this hook keeps the DOM and storage in sync afterwards.
 * `mounted` is false during SSR/first render so callers can avoid a hydration
 * mismatch on the current selection.
 */
export function useAccent() {
  const [accent, setAccentState] = useState(DEFAULT_ACCENT)
  const [customColor, setCustomColorState] = useState(() =>
    resolveCustomColor(null)
  )
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setAccentState(resolveAccent(localStorage.getItem(ACCENT_STORAGE_KEY)))
    setCustomColorState(
      resolveCustomColor(localStorage.getItem(ACCENT_COLOR_STORAGE_KEY))
    )
    setMounted(true)
  }, [])

  const persist = useCallback((key: string, value: string) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // Ignore storage failures (private mode, quota); the DOM still reflects
      // the choice for the current session.
    }
  }, [])

  const setAccent = useCallback(
    (next: string) => {
      const resolved = resolveAccent(next)
      setAccentState(resolved)
      persist(ACCENT_STORAGE_KEY, resolved)
      applyAccent(resolved, customColor)
    },
    [customColor, persist]
  )

  // Reflect a custom colour live (state + DOM) without touching storage. Used
  // on every drag frame so we don't hammer localStorage. Choosing a colour
  // implicitly switches the active accent to custom.
  const previewCustomColor = useCallback((next: string) => {
    const color = resolveCustomColor(next)
    setCustomColorState(color)
    setAccentState(CUSTOM_ACCENT)
    applyAccent(CUSTOM_ACCENT, color)
  }, [])

  // Persist the custom colour on commit (drag release / hex entry).
  const commitCustomColor = useCallback(
    (next: string) => {
      const color = resolveCustomColor(next)
      previewCustomColor(color)
      persist(ACCENT_COLOR_STORAGE_KEY, color)
      persist(ACCENT_STORAGE_KEY, CUSTOM_ACCENT)
    },
    [persist, previewCustomColor]
  )

  return {
    accent,
    customColor,
    setAccent,
    previewCustomColor,
    commitCustomColor,
    mounted,
  }
}
