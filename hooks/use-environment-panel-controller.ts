"use client"

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react"

import {
  cloneEntries,
  createEnvironmentPanelState,
  entriesEqual,
  entriesFromRows,
  envCache,
  environmentPanelReducer,
  makeId,
  validateEntries,
  validateEnvName,
  type EnvVar,
} from "@/components/sandbox/environment-panel-model"
import { fetchJson, postJson } from "@/lib/http/client-json"
import { dedupeEnvVars, parseDotenv } from "@/lib/env/dotenv-parse"

async function fetchEntries(sandboxId: string, signal?: AbortSignal) {
  const data = await fetchJson<{ entries?: EnvVar[] }>(
    `/api/sandbox/env?${new URLSearchParams({ sandboxId })}`,
    { credentials: "same-origin", signal },
    { fallbackError: "Failed to load environment variables." }
  )

  return data.entries ?? []
}

export function useEnvironmentPanelController(sandboxId: string | null) {
  const initialEntries = sandboxId ? envCache.get(sandboxId) : undefined
  const [state, dispatch] = useReducer(
    environmentPanelReducer,
    { initialEntries, sandboxId },
    createEnvironmentPanelState
  )
  const {
    adding,
    draftName,
    draftValue,
    error,
    original,
    pasteText,
    pasting,
    revealed,
    rows,
    status,
  } = state
  const dirtyRef = useRef(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isDirty = useMemo(() => !entriesEqual(rows, original), [original, rows])
  const pasteParsed = useMemo(() => parseDotenv(pasteText), [pasteText])
  const pasteVars = useMemo(
    () => dedupeEnvVars(pasteParsed.vars),
    [pasteParsed]
  )
  const setPasteTextareaRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      node?.focus()
    },
    []
  )
  const updatePasteText = useCallback((value: string) => {
    dispatch({ type: "paste-text", value })
  }, [])

  useEffect(() => {
    dirtyRef.current = isDirty
  }, [isDirty])

  const clearSavedTimer = useCallback(() => {
    if (!savedTimer.current) return
    clearTimeout(savedTimer.current)
    savedTimer.current = null
  }, [])

  useEffect(() => {
    if (!sandboxId) return

    const controller = new AbortController()
    dirtyRef.current = false

    void fetchEntries(sandboxId, controller.signal)
      .then((entries) => {
        envCache.set(sandboxId, cloneEntries(entries))
        if (!dirtyRef.current) {
          dispatch({ type: "apply-entries", entries, status: "idle" })
        } else {
          dispatch({ type: "set-status", status: "idle" })
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        dispatch({
          type: "load-error",
          error: err instanceof Error ? err.message : "Failed to load",
          status: initialEntries ? "idle" : "error",
        })
      })

    return () => controller.abort()
  }, [initialEntries, sandboxId])

  useEffect(() => clearSavedTimer, [clearSavedTimer])

  const updateRow = useCallback((id: string, patch: Partial<EnvVar>) => {
    dirtyRef.current = true
    dispatch({ type: "update-row", id, patch })
  }, [])

  const toggleReveal = useCallback((id: string) => {
    dispatch({ type: "toggle-reveal", id })
  }, [])

  const allRevealed =
    rows.length > 0 && rows.every((row) => revealed.has(row.id))

  const toggleRevealAll = useCallback(() => {
    dispatch({ type: "toggle-reveal-all" })
  }, [])

  const startAdding = useCallback(() => {
    dirtyRef.current = true
    dispatch({ type: "start-adding" })
  }, [])

  const updateDraftName = useCallback((value: string) => {
    dirtyRef.current = true
    dispatch({ type: "draft-name", value })
  }, [])

  const updateDraftValue = useCallback((value: string) => {
    dirtyRef.current = true
    dispatch({ type: "draft-value", value })
  }, [])

  const submitDraft = useCallback(() => {
    const name = draftName.trim()

    if (!name) return

    const nameError = validateEnvName(name)
    if (nameError) {
      dispatch({ type: "set-error", error: nameError })
      return
    }

    if (rows.some((row) => row.name.trim() === name)) {
      dispatch({ type: "set-error", error: `Duplicate variable "${name}"` })
      return
    }

    const id = makeId()
    dirtyRef.current = true
    dispatch({ type: "submit-draft", id, name, value: draftValue })
  }, [draftName, draftValue, rows])

  const cancelDraft = useCallback(() => {
    dispatch({ type: "cancel-draft" })
  }, [])

  const startPasting = useCallback(() => {
    dispatch({ type: "start-pasting" })
  }, [])

  const cancelPasting = useCallback(() => {
    dispatch({ type: "cancel-pasting" })
  }, [])

  const importPasted = useCallback(() => {
    if (pasteVars.length === 0) return

    dirtyRef.current = true
    dispatch({ type: "import-pasted", vars: pasteVars })
  }, [pasteVars])

  const persistEntries = useCallback(
    async (allEntries: EnvVar[]) => {
      if (!sandboxId) return false

      const validationError = validateEntries(allEntries)

      if (validationError) {
        dispatch({ type: "set-error", error: validationError, status: "error" })
        return false
      }

      dispatch({ type: "save-start" })

      try {
        const data = await postJson<{
          entries?: EnvVar[]
          ok?: boolean
        }>(
          "/api/sandbox/env",
          { entries: allEntries, sandboxId },
          {
            credentials: "same-origin",
          },
          { fallbackError: "Failed to save environment variables." }
        )

        if (!data.ok) {
          throw new Error("Failed to save environment variables.")
        }

        const next = cloneEntries(data.entries ?? allEntries)
        envCache.set(sandboxId, next)
        dispatch({ type: "apply-entries", entries: next, status: "saved" })

        clearSavedTimer()
        savedTimer.current = setTimeout(
          () => dispatch({ type: "saved-idle" }),
          1500
        )
        return true
      } catch (err) {
        dispatch({
          type: "save-error",
          error: err instanceof Error ? err.message : "Failed to save",
        })
        return false
      }
    },
    [clearSavedTimer, sandboxId]
  )

  const removeRow = useCallback(
    (id: string) => {
      if (status === "saving") return

      const nextRows = rows.filter((row) => row.id !== id)
      dirtyRef.current = true
      dispatch({ type: "remove-row", id })

      void persistEntries(entriesFromRows(nextRows))
    },
    [persistEntries, rows, status]
  )

  const save = useCallback(async () => {
    if (!sandboxId || status === "saving") return

    const entries = entriesFromRows(rows)
    const draftEntry =
      adding && draftName.trim()
        ? [{ name: draftName.trim(), value: draftValue }]
        : []
    const allEntries = [...entries, ...draftEntry]
    const validationError = validateEntries(allEntries)

    if (validationError) {
      dispatch({ type: "set-error", error: validationError, status: "error" })
      return
    }

    await persistEntries(allEntries)
  }, [adding, draftName, draftValue, persistEntries, rows, sandboxId, status])

  const isLoadingInitial = status === "loading" && rows.length === 0
  const isEmpty = rows.length === 0 && !adding && !pasting && !isLoadingInitial
  const showRevealAll = rows.length > 0
  const dirty = isDirty || adding
  const saving = status === "saving"

  return {
    adding,
    allRevealed,
    cancelDraft,
    cancelPasting,
    dirty,
    draftName,
    draftValue,
    error,
    importPasted,
    isEmpty,
    isLoadingInitial,
    pasteParsed,
    pasteText,
    pasteVars,
    pasting,
    removeRow,
    revealed,
    rows,
    save,
    saving,
    setPasteTextareaRef,
    showRevealAll,
    startAdding,
    startPasting,
    status,
    submitDraft,
    toggleReveal,
    toggleRevealAll,
    updateDraftName,
    updateDraftValue,
    updatePasteText,
    updateRow,
  }
}
