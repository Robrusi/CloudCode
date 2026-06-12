export const TERMINAL_DEFAULT_COLS = 100
export const TERMINAL_DEFAULT_ROWS = 30
const TERMINAL_MAX_COLS = 300
const TERMINAL_MAX_ROWS = 120
const TERMINAL_MIN_COLS = 20
const TERMINAL_MIN_ROWS = 8

export function cleanTerminalId(terminalId: string) {
  const trimmed = terminalId.trim()
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(trimmed)) {
    throw new Error("Invalid terminal id.")
  }
  return trimmed
}

function cleanTerminalSize(
  value: unknown,
  fallback: number,
  min: number,
  max: number
) {
  const number = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

export function cleanTerminalDimensions({
  cols,
  rows,
}: {
  cols?: unknown
  rows?: unknown
}) {
  return {
    cols: cleanTerminalSize(
      cols,
      TERMINAL_DEFAULT_COLS,
      TERMINAL_MIN_COLS,
      TERMINAL_MAX_COLS
    ),
    rows: cleanTerminalSize(
      rows,
      TERMINAL_DEFAULT_ROWS,
      TERMINAL_MIN_ROWS,
      TERMINAL_MAX_ROWS
    ),
  }
}
