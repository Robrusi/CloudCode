"use client"

import {
  Check,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react"
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
type LocalRow = EnvVar & { id: string; isNew?: boolean }

type Status = "idle" | "loading" | "saving" | "error"

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

function maskedDots(value: string) {
  // Render a fixed-width-ish dot string for visual rhythm — but cap so a very
  // long secret doesn't blow out the row.
  const length = Math.min(Math.max(value.length, 6), 18)
  return "•".repeat(length)
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

  const isDirty = useMemo(() => {
    if (rows.length !== original.length) return true
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i]
      const b = original[i]
      if (a.name !== b.name || a.value !== b.value) return true
    }
    return false
  }, [rows, original])

  const load = useCallback(async () => {
    if (!sandboxId) return
    setStatus("loading")
    setError(null)
    try {
      const res = await fetch(
        `/api/sandbox/env?${new URLSearchParams({ sandboxId })}`,
        { cache: "no-store" }
      )
      const data = (await res.json()) as { entries?: EnvVar[]; error?: string }
      if (!res.ok)
        throw new Error(data.error ?? `Request failed (${res.status})`)
      const entries = data.entries ?? []
      setOriginal(entries)
      setRows(entries.map((e) => ({ ...e, id: makeId() })))
      setStatus("idle")
    } catch (err) {
      setStatus("error")
      setError(err instanceof Error ? err.message : "Failed to load")
    }
  }, [sandboxId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (adding) addNameRef.current?.focus()
  }, [adding])

  const toggleReveal = useCallback((id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const updateRow = useCallback((id: string, patch: Partial<EnvVar>) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    )
  }, [])

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id))
    setRevealed((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const submitDraft = useCallback(() => {
    const name = draftName.trim()
    if (!name) return
    if (!ENV_NAME_PATTERN.test(name)) {
      setError(`Invalid name "${name}" — use letters, digits and "_" only.`)
      return
    }
    if (rows.some((r) => r.name === name)) {
      setError(`"${name}" already exists.`)
      return
    }
    const id = makeId()
    setRows((prev) => [...prev, { id, isNew: true, name, value: draftValue }])
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
    if (!sandboxId) return
    // validate all
    const seen = new Set<string>()
    for (const row of rows) {
      const trimmed = row.name.trim()
      if (!ENV_NAME_PATTERN.test(trimmed)) {
        setError(`Invalid name "${trimmed || "(empty)"}"`)
        return
      }
      if (seen.has(trimmed)) {
        setError(`Duplicate variable "${trimmed}"`)
        return
      }
      seen.add(trimmed)
    }
    setStatus("saving")
    setError(null)
    try {
      const res = await fetch("/api/sandbox/env", {
        body: JSON.stringify({
          entries: rows.map((r) => ({ name: r.name.trim(), value: r.value })),
          sandboxId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      })
      const data = (await res.json()) as { entries?: EnvVar[]; error?: string }
      if (!res.ok)
        throw new Error(data.error ?? `Request failed (${res.status})`)
      const next = data.entries ?? []
      setOriginal(next)
      setRows(next.map((e) => ({ ...e, id: makeId() })))
      setStatus("idle")
    } catch (err) {
      setStatus("error")
      setError(err instanceof Error ? err.message : "Failed to save")
    }
  }, [rows, sandboxId])

  const discard = useCallback(() => {
    setRows(original.map((e) => ({ ...e, id: makeId() })))
    setRevealed(new Set())
    setError(null)
  }, [original])

  if (!sandboxId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-xs text-muted-foreground">No active sandbox.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            .env.local
          </span>
          {status === "loading" || status === "saving" ? (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
          Add
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {status === "loading" && rows.length === 0 ? null : rows.length === 0 &&
          !adding ? (
          <EmptyState onAdd={() => setAdding(true)} />
        ) : (
          <ul className="flex flex-col gap-1">
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
          </ul>
        )}

        {adding ? (
          <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-dashed border-border/70 bg-sidebar-accent/30 p-2">
            <input
              ref={addNameRef}
              aria-label="Variable name"
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className={inputClass}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => handleDraftKey(e, submitDraft, cancelDraft)}
              placeholder="KEY"
              spellCheck={false}
              value={draftName}
            />
            <input
              aria-label="Variable value"
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className={inputClass}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={(e) => handleDraftKey(e, submitDraft, cancelDraft)}
              placeholder="value"
              spellCheck={false}
              value={draftValue}
            />
            <div className="flex items-center justify-end gap-1 pt-0.5">
              <button
                className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                onClick={cancelDraft}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex h-6 items-center gap-1 rounded-md bg-foreground px-2 text-[11px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                disabled={!draftName.trim()}
                onClick={submitDraft}
                type="button"
              >
                <Check className="size-3" />
                Add
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="flex shrink-0 items-start gap-1.5 border-t border-border/60 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      ) : null}

      {isDirty ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 bg-sidebar px-3 py-2">
          <span className="text-[11px] text-muted-foreground">
            Unsaved changes
          </span>
          <div className="flex items-center gap-1">
            <button
              className="inline-flex h-7 items-center rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:opacity-40"
              disabled={status === "saving"}
              onClick={discard}
              type="button"
            >
              Discard
            </button>
            <button
              className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-2.5 text-[11px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              disabled={status === "saving"}
              onClick={save}
              type="button"
            >
              {status === "saving" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Check className="size-3" />
              )}
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const inputClass = cn(
  "h-7 w-full rounded-sm border border-transparent bg-transparent px-1.5",
  "font-mono text-[11.5px] text-foreground placeholder:text-muted-foreground/60",
  "transition-colors outline-none",
  "focus:border-border focus:bg-background"
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
  const [editingValue, setEditingValue] = useState(false)
  const valueInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editingValue) {
      valueInputRef.current?.focus()
      valueInputRef.current?.select()
    }
  }, [editingValue])

  const showValue = revealed || editingValue

  return (
    <li className="group relative flex flex-col gap-0.5 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border/50 hover:bg-sidebar-accent/40">
      <div className="flex items-center gap-1.5">
        <input
          aria-label="Variable name"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className={cn(
            inputClass,
            "h-5 flex-1 px-0 text-[11.5px] font-medium tracking-tight text-foreground/90"
          )}
          onChange={(e) => onChange({ name: e.target.value })}
          spellCheck={false}
          value={row.name}
        />
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <IconButton
            label={revealed ? "Hide value" : "Reveal value"}
            onClick={onToggleReveal}
          >
            {revealed ? (
              <EyeOff className="size-3" />
            ) : (
              <Eye className="size-3" />
            )}
          </IconButton>
          <IconButton label="Delete variable" onClick={onRemove}>
            <Trash2 className="size-3" />
          </IconButton>
        </div>
      </div>
      <div className="flex items-center">
        {showValue ? (
          <input
            ref={valueInputRef}
            aria-label="Variable value"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className={cn(
              inputClass,
              "h-5 px-0 text-[11px] text-muted-foreground"
            )}
            onBlur={() => setEditingValue(false)}
            onChange={(e) => onChange({ value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault()
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            spellCheck={false}
            value={row.value}
          />
        ) : (
          <button
            className="flex h-5 w-full items-center rounded-sm text-left font-mono text-[11px] tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setEditingValue(true)}
            title="Click to edit"
            type="button"
          >
            {row.value ? (
              maskedDots(row.value)
            ) : (
              <span className="text-muted-foreground/50">(empty)</span>
            )}
          </button>
        )}
      </div>
    </li>
  )
}

function IconButton({
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
      className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
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
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="flex size-9 items-center justify-center rounded-full border border-dashed border-border/70 text-muted-foreground">
        <Plus className="size-4" />
      </div>
      <div className="space-y-0.5">
        <p className="text-xs font-medium text-foreground/85">
          No environment variables
        </p>
        <p className="text-[11px] text-muted-foreground">
          Add variables to your .env.local
        </p>
      </div>
      <button
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border/70 px-2.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-sidebar-accent"
        onClick={onAdd}
        type="button"
      >
        <Plus className="size-3" />
        Add variable
      </button>
    </div>
  )
}
