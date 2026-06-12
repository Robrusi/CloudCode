export type UnknownRecord = Record<string, unknown>

export function objectRecord(value: unknown): UnknownRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as UnknownRecord
  }

  return undefined
}

export function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function rawStringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

export function finiteNumberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function positiveNumberValue(value: unknown) {
  const number = finiteNumberValue(value)
  return number && number > 0 ? number : undefined
}
