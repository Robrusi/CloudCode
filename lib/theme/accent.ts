/**
 * Accent theme. The primary ("solid") buttons, sliders, and toggles read the
 * `--accent-solid` / `--accent-solid-foreground` CSS variables. Those default
 * to the neutral foreground/background pair in `app/globals.css`; a chosen
 * accent overrides them as inline styles on `<html>` (see hooks/use-accent.ts).
 */

export const ACCENT_STORAGE_KEY = "cc-accent"
export const ACCENT_COLOR_STORAGE_KEY = "cc-accent-color"
export const ACCENT_ATTRIBUTE = "data-accent"

/** Neutral default — keeps the black/white (foreground/background) look. */
export const DEFAULT_ACCENT = "mono"

/** Free-form accent whose colour is picked from the colour picker. */
export const CUSTOM_ACCENT = "custom"

/** Fallback colour for the custom accent before the user picks one (indigo). */
export const DEFAULT_CUSTOM_COLOR = "#6366f1"

const ACCENT_IDS = new Set([DEFAULT_ACCENT, CUSTOM_ACCENT])

/** Narrow an arbitrary string (e.g. from storage) to a known accent id. */
export function resolveAccent(value: string | null | undefined): string {
  return value && ACCENT_IDS.has(value) ? value : DEFAULT_ACCENT
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Narrow an arbitrary string to a valid `#rgb`/`#rrggbb` colour. */
export function resolveCustomColor(value: string | null | undefined): string {
  return value && HEX_COLOR.test(value) ? value : DEFAULT_CUSTOM_COLOR
}

/**
 * Picks readable text (near-white or near-black) for a solid background, using
 * perceived sRGB luminance. Kept in sync with the inline luminance check in the
 * pre-paint script in app/layout.tsx.
 */
export function contrastForeground(hex: string): string {
  const raw = resolveCustomColor(hex).slice(1)
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : raw
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 0.6 ? "#0a0a0a" : "#ffffff"
}
