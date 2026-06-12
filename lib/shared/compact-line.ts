const ANSI_ESCAPE_PATTERN = new RegExp(
  String.raw`\u001B\[[0-?]*[ -/]*[@-~]`,
  "g"
)

export function compactLine(value: string, max = 220, marker = "...") {
  const line = value.replace(/\s+/g, " ").trim()
  return line.length > max
    ? `${line.slice(0, Math.max(0, max - marker.length))}${marker}`
    : line
}

export function compactAnsiLine(value: string, max = 220) {
  return compactLine(value.replace(ANSI_ESCAPE_PATTERN, ""), max)
}
