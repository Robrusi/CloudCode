"use client"

import { Eye, EyeOff, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react"
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { cn } from "@/lib/utils"

type EnvVar = { name: string; value: string }
type LocalRow = EnvVar & { id: string }
type Status = "error" | "idle" | "loading" | "saved" | "saving"

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const envCache = new Map<string, EnvVar[]>()

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

function cloneEntries(entries: EnvVar[]) {
  return entries.map((entry) => ({ name: entry.name, value: entry.value }))
}

function rowsFromEntries(entries: EnvVar[]): LocalRow[] {
  return entries.map((entry) => ({ ...entry, id: makeId() }))
}

function maskedDots(value: string) {
  const length = Math.min(Math.max(value.length, 6), 18)
  return "•".repeat(length)
}

function entriesEqual(rows: LocalRow[], original: EnvVar[]) {
  if (rows.length !== original.length) return false

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const entry = original[index]
    if (row.name !== entry.name || row.value !== entry.value) return false
  }

  return true
}

function validateEntries(entries: EnvVar[]) {
  const seen = new Set<string>()

  for (const entry of entries) {
    const name = entry.name.trim()

    if (!ENV_NAME_PATTERN.test(name)) {
      return `Invalid name "${name || "(empty)"}"`
    }

    if (seen.has(name)) {
      return `Duplicate variable "${name}"`
    }

    seen.add(name)
  }

  return null
}

async function fetchEntries(sandboxId: string, signal?: AbortSignal) {
  const res = await fetch(
    `/api/sandbox/env?${new URLSearchParams({ sandboxId })}`,
    { cache: "no-store", credentials: "same-origin", signal }
  )
  const data = (await res.json()) as { entries?: EnvVar[]; error?: string }

  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`)
  }

  return data.entries ?? []
}

export function EnvironmentPanel({ sandboxId }: { sandboxId: string | null }) {
  const [rows, setRows] = useState<LocalRow[]>([])
  const [original, setOriginal] = useState<EnvVar[]>([])
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [draftValue, setDraftValue] = useState("")
  const addNameRef = useRef<HTMLInputElement | null>(null)
  const dirtyRef = useRef(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isDirty = useMemo(() => !entriesEqual(rows, original), [original, rows])

  useEffect(() => {
    dirtyRef.current = isDirty
  }, [isDirty])

  const applyEntries = useCallback((entries: EnvVar[]) => {
    const next = cloneEntries(entries)
    setOriginal(next)
    setRows(rowsFromEntries(next))
    setRevealed(new Set())
    setAdding(false)
    setDraftName("")
    setDraftValue("")
  }, [])

  useEffect(() => {
    if (!sandboxId) {
      setRows([])
      setOriginal([])
      setStatus("idle")
      setError(null)
      return
    }

    const controller = new AbortController()
    const cached = envCache.get(sandboxId)
    dirtyRef.current = false

    if (cached) {
      applyEntries(cached)
    } else {
      setRows([])
      setOriginal([])
    }

    setStatus("loading")
    setError(null)

    void fetchEntries(sandboxId, controller.signal)
      .then((entries) => {
        envCache.set(sandboxId, cloneEntries(entries))
        if (!dirtyRef.current) {
          applyEntries(entries)
        }
        setStatus("idle")
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setStatus(cached ? "idle" : "error")
        setError(err instanceof Error ? err.message : "Failed to load")
      })

    return () => controller.abort()
  }, [applyEntries, sandboxId])

  useEffect(() => {
    if (adding) addNameRef.current?.focus()
  }, [adding])

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  const updateRow = useCallback((id: string, patch: Partial<EnvVar>) => {
    dirtyRef.current = true
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    )
  }, [])

  const removeRow = useCallback((id: string) => {
    dirtyRef.current = true
    setRows((prev) => prev.filter((row) => row.id !== id))
    setRevealed((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const toggleReveal = useCallback((id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allRevealed =
    rows.length > 0 && rows.every((row) => revealed.has(row.id))

  const toggleRevealAll = useCallback(() => {
    setRevealed((prev) => {
      if (rows.length > 0 && rows.every((row) => prev.has(row.id))) {
        return new Set()
      }

      return new Set(rows.map((row) => row.id))
    })
  }, [rows])

  const startAdding = useCallback(() => {
    dirtyRef.current = true
    setAdding(true)
    setError(null)
  }, [])

  const updateDraftName = useCallback((value: string) => {
    dirtyRef.current = true
    setDraftName(value)
  }, [])

  const updateDraftValue = useCallback((value: string) => {
    dirtyRef.current = true
    setDraftValue(value)
  }, [])

  const submitDraft = useCallback(() => {
    const name = draftName.trim()

    if (!name) return

    if (!ENV_NAME_PATTERN.test(name)) {
      setError(`Invalid name "${name}"`)
      return
    }

    if (rows.some((row) => row.name.trim() === name)) {
      setError(`Duplicate variable "${name}"`)
      return
    }

    const id = makeId()
    dirtyRef.current = true
    setRows((prev) => [...prev, { id, name, value: draftValue }])
    setRevealed((prev) => {
      if (!draftValue) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setDraftName("")
    setDraftValue("")
    setAdding(false)
    setError(null)
  }, [draftName, draftValue, rows])

  const cancelDraft = useCallback(() => {
    setDraftName("")
    setDraftValue("")
    setAdding(false)
    setError(null)
  }, [])

  const save = useCallback(async () => {
    if (!sandboxId || status === "saving") return

    const entries = rows.map((row) => ({
      name: row.name.trim(),
      value: row.value,
    }))
    const draftEntry =
      adding && draftName.trim()
        ? [{ name: draftName.trim(), value: draftValue }]
        : []
    const allEntries = [...entries, ...draftEntry]
    const validationError = validateEntries(allEntries)

    if (validationError) {
      setError(validationError)
      setStatus("error")
      return
    }

    setStatus("saving")
    setError(null)

    try {
      const res = await fetch("/api/sandbox/env", {
        body: JSON.stringify({ entries: allEntries, sandboxId }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const data = (await res.json()) as {
        entries?: EnvVar[]
        error?: string
        ok?: boolean
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`)
      }

      const next = cloneEntries(data.entries ?? allEntries)
      envCache.set(sandboxId, next)
      applyEntries(next)
      setStatus("saved")

      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setStatus("idle"), 1500)
    } catch (err) {
      setStatus("error")
      setError(err instanceof Error ? err.message : "Failed to save")
    }
  }, [adding, applyEntries, draftName, draftValue, rows, sandboxId, status])

  if (!sandboxId) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-xs text-muted-foreground">No active sandbox.</p>
      </div>
    )
  }

  const isLoadingInitial = status === "loading" && rows.length === 0
  const isEmpty = rows.length === 0 && !adding && !isLoadingInitial
  const showRevealAll = rows.length > 0

  const dirty = isDirty || adding
  const saving = status === "saving"

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-4">
        <div className="flex items-center justify-between gap-2 px-0.5 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-sm font-medium text-foreground/85">Secrets</h2>
            {status === "loading" ? (
              <Loader2
                aria-label="Refreshing"
                className="size-3 animate-spin text-muted-foreground"
              />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {showRevealAll ? (
              <button
                aria-label={allRevealed ? "Hide values" : "Reveal values"}
                aria-pressed={allRevealed}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors hover:bg-muted hover:text-foreground",
                  allRevealed
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground"
                )}
                onClick={toggleRevealAll}
                type="button"
              >
                {allRevealed ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
                {allRevealed ? "Hide" : "Reveal"}
              </button>
            ) : null}
            <button
              aria-label="Add variable"
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2.5 text-xs text-foreground/80 transition-colors hover:bg-muted"
              onClick={startAdding}
              type="button"
            >
              <Plus className="size-3.5" />
              Add
            </button>
          </div>
        </div>

        {isLoadingInitial ? (
          <div className="grid h-32 place-items-center rounded-xl border border-border/60 bg-background">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : isEmpty ? (
          <EmptyState onAdd={startAdding} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60 bg-background">
            <ul>
              {rows.map((row) => (
                <EnvRow
                  key={row.id}
                  onChange={(patch) => updateRow(row.id, patch)}
                  onRemove={() => removeRow(row.id)}
                  onToggleReveal={() => toggleReveal(row.id)}
                  revealed={revealed.has(row.id)}
                  row={row}
                />
              ))}
              {adding ? (
                <DraftRow
                  name={draftName}
                  nameRef={addNameRef}
                  onCancel={cancelDraft}
                  onChangeName={updateDraftName}
                  onChangeValue={updateDraftValue}
                  onSubmit={submitDraft}
                  value={draftValue}
                />
              ) : null}
            </ul>

            {error ? (
              <div className="flex items-start gap-1.5 border-t border-border/60 bg-destructive/10 px-3.5 py-2 text-[11px] text-destructive">
                <TriangleAlert className="mt-px size-3 shrink-0" />
                <span className="break-words">{error}</span>
              </div>
            ) : null}

            {dirty ? (
              <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-4 py-2.5">
                <span className="text-[11px] text-muted-foreground">
                  Unsaved changes
                </span>
                <button
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-40"
                  disabled={saving}
                  onClick={save}
                  type="button"
                >
                  {saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Save
                </button>
              </div>
            ) : null}
          </div>
        )}

        {(isLoadingInitial || isEmpty) && error ? (
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            <TriangleAlert className="mt-px size-3 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const nameInputClass = cn(
  "w-full min-w-0 border-0 bg-transparent p-0 outline-none",
  "font-mono text-[13px] font-medium text-foreground",
  "placeholder:font-medium placeholder:text-muted-foreground/40"
)

const valueInputClass = cn(
  "w-full min-w-0 border-0 bg-transparent p-0 outline-none",
  "font-mono text-[13px] text-muted-foreground",
  "placeholder:text-muted-foreground/40 focus:text-foreground/80"
)

function handleDraftKey(
  event: KeyboardEvent<HTMLInputElement>,
  submit: () => void,
  cancel: () => void
) {
  if (event.key === "Enter") {
    event.preventDefault()
    submit()
  } else if (event.key === "Escape") {
    event.preventDefault()
    cancel()
  }
}

function EnvRow({
  row,
  revealed,
  onChange,
  onRemove,
  onToggleReveal,
}: {
  row: LocalRow
  revealed: boolean
  onChange: (patch: Partial<EnvVar>) => void
  onRemove: () => void
  onToggleReveal: () => void
}) {
  return (
    <li className="group flex items-center gap-3 border-b border-border/50 px-4 py-3 transition-colors last:border-b-0 focus-within:bg-muted/30 hover:bg-muted/30">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          aria-label="Variable name"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className={nameInputClass}
          onChange={(event) => onChange({ name: event.target.value })}
          spellCheck={false}
          value={row.name}
        />
        <input
          aria-label={`${row.name || "Variable"} value`}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className={valueInputClass}
          data-1p-ignore
          data-lpignore="true"
          onChange={(event) => onChange({ value: event.target.value })}
          placeholder={row.value ? maskedDots(row.value) : "(empty)"}
          spellCheck={false}
          type={revealed ? "text" : "password"}
          value={row.value}
        />
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <RowIconButton
          label={revealed ? "Hide value" : "Reveal value"}
          onClick={onToggleReveal}
        >
          {revealed ? (
            <EyeOff className="size-3.5" />
          ) : (
            <Eye className="size-3.5" />
          )}
        </RowIconButton>
        <RowIconButton label="Delete variable" onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </RowIconButton>
      </div>
    </li>
  )
}

function DraftRow({
  name,
  nameRef,
  value,
  onCancel,
  onChangeName,
  onChangeValue,
  onSubmit,
}: {
  name: string
  nameRef: React.RefObject<HTMLInputElement | null>
  value: string
  onCancel: () => void
  onChangeName: (value: string) => void
  onChangeValue: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <li className="flex items-center gap-3 border-b border-border/50 bg-muted/30 px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          ref={nameRef}
          aria-label="Variable name"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className={nameInputClass}
          onChange={(event) => onChangeName(event.target.value)}
          onKeyDown={(event) => handleDraftKey(event, onSubmit, onCancel)}
          placeholder="Name"
          spellCheck={false}
          value={name}
        />
        <input
          aria-label="Variable value"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className={valueInputClass}
          data-1p-ignore
          data-lpignore="true"
          onChange={(event) => onChangeValue(event.target.value)}
          onKeyDown={(event) => handleDraftKey(event, onSubmit, onCancel)}
          placeholder="value"
          spellCheck={false}
          type="password"
          value={value}
        />
      </div>
      <RowIconButton label="Discard new variable" onClick={onCancel}>
        <Trash2 className="size-3.5" />
      </RowIconButton>
    </li>
  )
}

function RowIconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border/60 bg-background px-6 py-10 text-center">
      <div className="flex size-9 items-center justify-center rounded-full border border-dashed border-border/70 text-muted-foreground">
        <Plus className="size-4" />
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-medium text-foreground/80">No secrets yet</p>
        <p className="text-[11px] text-muted-foreground">
          Add a variable to the sandbox&apos;s .env.local.
        </p>
      </div>
      <button
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 px-2.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-muted"
        onClick={onAdd}
        type="button"
      >
        <Plus className="size-3" />
        Add variable
      </button>
    </div>
  )
}
