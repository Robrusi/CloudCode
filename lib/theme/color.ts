/**
 * Small colour-space helpers for the accent colour picker. HSV is convenient
 * for a saturation/value square plus a hue slider; hex is what we persist and
 * feed to CSS. Pure functions, no DOM — safe to unit test.
 */

export type Hsv = { h: number; s: number; v: number }

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function channelToHex(value: number): string {
  return Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, "0")
}

/** Convert HSV (h in [0,360), s/v in [0,1]) to a `#rrggbb` string. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const chroma = v * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = chroma * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [chroma, x, 0]
  else if (hp < 2) [r, g, b] = [x, chroma, 0]
  else if (hp < 3) [r, g, b] = [0, chroma, x]
  else if (hp < 4) [r, g, b] = [0, x, chroma]
  else if (hp < 5) [r, g, b] = [x, 0, chroma]
  else [r, g, b] = [chroma, 0, x]
  const m = v - chroma
  return `#${channelToHex(r + m)}${channelToHex(g + m)}${channelToHex(b + m)}`
}

/** Convert a `#rgb`/`#rrggbb` string to HSV. Grays keep h = 0. */
export function hexToHsv(hex: string): Hsv {
  let raw = hex.replace("#", "")
  if (raw.length === 3) {
    raw = raw
      .split("")
      .map((channel) => channel + channel)
      .join("")
  }
  const r = parseInt(raw.slice(0, 2), 16) / 255
  const g = parseInt(raw.slice(2, 4), 16) / 255
  const b = parseInt(raw.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : delta / max
  return { h, s, v: max }
}
