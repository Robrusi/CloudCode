import { ENV_NAME_PATTERN } from "@/lib/env/dotenv-parse"
import type { SandboxEnvVar } from "@/lib/sandbox/env"

export type EnvVar = SandboxEnvVar
export type LocalRow = EnvVar & { id: string }
export type Status = "error" | "idle" | "loading" | "saved" | "saving"

export type EnvironmentPanelState = {
  adding: boolean
  draftName: string
  draftValue: string
  error: string | null
  original: EnvVar[]
  pasteText: string
  pasting: boolean
  revealed: Set<string>
  rows: LocalRow[]
  status: Status
}

export type EnvironmentPanelAction =
  | { type: "apply-entries"; entries: EnvVar[]; status?: Status }
  | { type: "cancel-draft" }
  | { type: "cancel-pasting" }
  | { type: "draft-name"; value: string }
  | { type: "draft-value"; value: string }
  | { type: "import-pasted"; vars: EnvVar[] }
  | { type: "load-error"; error: string; status: Status }
  | { type: "paste-text"; value: string }
  | { type: "remove-row"; id: string }
  | { type: "save-error"; error: string }
  | { type: "save-start" }
  | { type: "saved-idle" }
  | { type: "set-error"; error: string; status?: Status }
  | { type: "set-status"; status: Status }
  | { type: "start-adding" }
  | { type: "start-pasting" }
  | { type: "submit-draft"; id: string; name: string; value: string }
  | { type: "toggle-reveal"; id: string }
  | { type: "toggle-reveal-all" }
  | { type: "update-row"; id: string; patch: Partial<EnvVar> }

export const envCache = new Map<string, EnvVar[]>()

export function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

export function cloneEntries(entries: EnvVar[]) {
  return entries.map((entry) => ({ name: entry.name, value: entry.value }))
}

function rowsFromEntries(entries: EnvVar[]): LocalRow[] {
  return entries.map((entry) => ({ ...entry, id: makeId() }))
}

export function entriesFromRows(rows: LocalRow[]): EnvVar[] {
  return rows.map((row) => ({
    name: row.name.trim(),
    value: row.value,
  }))
}

export function maskedDots(value: string) {
  const length = Math.min(Math.max(value.length, 6), 18)
  return "•".repeat(length)
}

export function entriesEqual(rows: LocalRow[], original: EnvVar[]) {
  if (rows.length !== original.length) return false

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const entry = original[index]
    if (row.name !== entry.name || row.value !== entry.value) return false
  }

  return true
}

export function validateEnvName(name: string) {
  return ENV_NAME_PATTERN.test(name) ? null : `Invalid name "${name}"`
}

export function validateEntries(entries: EnvVar[]) {
  const seen = new Set<string>()

  for (const entry of entries) {
    const name = entry.name.trim()
    const nameError = validateEnvName(name || "(empty)")

    if (nameError) return nameError

    if (seen.has(name)) {
      return `Duplicate variable "${name}"`
    }

    seen.add(name)
  }

  return null
}

export function createEnvironmentPanelState({
  initialEntries,
  sandboxId,
}: {
  initialEntries?: EnvVar[]
  sandboxId: string | null
}): EnvironmentPanelState {
  const entries = initialEntries ? cloneEntries(initialEntries) : []
  return {
    adding: false,
    draftName: "",
    draftValue: "",
    error: null,
    original: entries,
    pasteText: "",
    pasting: false,
    revealed: new Set(),
    rows: rowsFromEntries(entries),
    status: sandboxId && !initialEntries ? "loading" : "idle",
  }
}

export function environmentPanelReducer(
  state: EnvironmentPanelState,
  action: EnvironmentPanelAction
): EnvironmentPanelState {
  switch (action.type) {
    case "apply-entries": {
      const next = cloneEntries(action.entries)
      // Keep existing row ids when the data matches what is displayed, so a
      // background refresh or save does not remount rows and drop focus or
      // reveal state.
      const rowsUnchanged = entriesEqual(state.rows, next)
      return {
        ...state,
        adding: false,
        draftName: "",
        draftValue: "",
        error: null,
        original: next,
        pasteText: "",
        pasting: false,
        revealed: rowsUnchanged ? state.revealed : new Set(),
        rows: rowsUnchanged ? state.rows : rowsFromEntries(next),
        status: action.status ?? state.status,
      }
    }
    case "cancel-draft":
      return {
        ...state,
        adding: false,
        draftName: "",
        draftValue: "",
        error: null,
      }
    case "cancel-pasting":
      return { ...state, error: null, pasteText: "", pasting: false }
    case "draft-name":
      return { ...state, draftName: action.value }
    case "draft-value":
      return { ...state, draftValue: action.value }
    case "import-pasted": {
      const rows = [...state.rows]
      const indexByName = new Map(
        rows.map((row, index) => [row.name.trim(), index])
      )

      for (const entry of action.vars) {
        const existingIndex = indexByName.get(entry.name)
        if (existingIndex !== undefined) {
          rows[existingIndex] = { ...rows[existingIndex], value: entry.value }
        } else {
          rows.push({ id: makeId(), name: entry.name, value: entry.value })
          indexByName.set(entry.name, rows.length - 1)
        }
      }

      return { ...state, error: null, pasteText: "", pasting: false, rows }
    }
    case "load-error":
      return { ...state, error: action.error, status: action.status }
    case "paste-text":
      return { ...state, pasteText: action.value }
    case "remove-row": {
      const revealed = new Set(state.revealed)
      revealed.delete(action.id)
      return {
        ...state,
        revealed,
        rows: state.rows.filter((row) => row.id !== action.id),
      }
    }
    case "save-error":
      return { ...state, error: action.error, status: "error" }
    case "save-start":
      return { ...state, error: null, status: "saving" }
    case "saved-idle":
      return { ...state, status: "idle" }
    case "set-error":
      return {
        ...state,
        error: action.error,
        status: action.status ?? state.status,
      }
    case "set-status":
      return { ...state, status: action.status }
    case "start-adding":
      return { ...state, adding: true, error: null }
    case "start-pasting":
      return { ...state, error: null, pasting: true }
    case "submit-draft": {
      const rows = [
        ...state.rows,
        { id: action.id, name: action.name, value: action.value },
      ]
      const revealed = new Set(state.revealed)
      if (action.value) revealed.add(action.id)
      return {
        ...state,
        adding: false,
        draftName: "",
        draftValue: "",
        error: null,
        revealed,
        rows,
      }
    }
    case "toggle-reveal": {
      const revealed = new Set(state.revealed)
      if (revealed.has(action.id)) revealed.delete(action.id)
      else revealed.add(action.id)
      return { ...state, revealed }
    }
    case "toggle-reveal-all": {
      const allRevealed =
        state.rows.length > 0 &&
        state.rows.every((row) => state.revealed.has(row.id))
      return {
        ...state,
        revealed: allRevealed
          ? new Set()
          : new Set(state.rows.map((row) => row.id)),
      }
    }
    case "update-row":
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === action.id ? { ...row, ...action.patch } : row
        ),
      }
  }
}
