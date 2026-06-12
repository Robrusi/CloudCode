export function firstHeaderValue(value: string | null | undefined) {
  return value?.split(",")[0]?.trim() || null
}

export function forwardedHeaderParts(value: string | null | undefined) {
  const result: { host?: string; proto?: string } = {}
  const firstEntry = firstHeaderValue(value)
  if (!firstEntry) return result

  for (const pair of firstEntry.split(";")) {
    const [rawName, ...rawValue] = pair.split("=")
    const name = rawName?.trim().toLowerCase()
    if (name !== "host" && name !== "proto") continue

    const part = rawValue.join("=").trim().replace(/^"|"$/g, "")
    if (part) result[name] = part
  }

  return result
}
