"use client"

import { Check, ChevronDown, GitBranch, Package } from "lucide-react"
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"

import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"

type SandboxPresetOption = {
  id: Id<"sandboxPresets">
  name: string
}

function repoLabel(url: string) {
  if (!url) return "Untitled"
  return url
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="block">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      {children}
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground/80">{hint}</div>
      ) : null}
    </div>
  )
}

export function IconButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function RepoChip({
  value,
  editing,
  setEditing,
  onChange,
  locked,
}: {
  value: string
  editing: boolean
  setEditing: (v: boolean) => void
  onChange: (v: string) => void
  locked?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commit() {
    onChange(draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex h-8 items-center gap-1.5 rounded-full border border-border/80 bg-background pr-1 pl-2.5 text-xs">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
            if (e.key === "Escape") {
              setDraft(value)
              setEditing(false)
            }
          }}
          placeholder="https://github.com/owner/repo.git"
          className="w-52 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          spellCheck={false}
        />
      </div>
    )
  }

  const label = value ? repoLabel(value) : "Connect repo"

  return (
    <button
      type="button"
      onClick={() => {
        if (!locked) {
          setDraft(value)
          setEditing(true)
        }
      }}
      disabled={locked}
      className={cn(
        "flex h-8 max-w-[14rem] items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors",
        value
          ? "text-foreground/80 hover:bg-muted disabled:hover:bg-transparent"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <GitBranch className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function BranchChip({
  value,
  onChange,
  locked,
}: {
  value: string
  onChange: (v: string) => void
  locked?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commit() {
    onChange(draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex h-8 items-center gap-1.5 rounded-full border border-border/80 bg-background pr-1 pl-2.5 text-xs">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
            if (e.key === "Escape") {
              setDraft(value)
              setEditing(false)
            }
          }}
          placeholder="default branch"
          className="w-24 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          spellCheck={false}
        />
      </div>
    )
  }

  const label = value || "default branch"

  return (
    <button
      type="button"
      onClick={() => {
        if (!locked) {
          setDraft(value)
          setEditing(true)
        }
      }}
      disabled={locked}
      title={
        locked ? "Base branch is locked once a chat starts" : "Base branch"
      }
      className={cn(
        "flex h-8 max-w-[10rem] items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors disabled:hover:bg-transparent",
        value
          ? "text-foreground/80 hover:bg-muted"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <GitBranch className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function PresetPill({
  activeLabel,
  locked,
  onSelect,
  open,
  presets,
  setOpen,
  value,
}: {
  activeLabel?: string
  locked?: boolean
  onSelect: (value: Id<"sandboxPresets"> | "") => void
  open: boolean
  presets: SandboxPresetOption[]
  setOpen: (value: boolean) => void
  value: Id<"sandboxPresets"> | ""
}) {
  const ref = useRef<HTMLDivElement>(null)
  const selected = presets.find((preset) => preset.id === value)
  const label = selected?.name ?? activeLabel ?? "Default"

  useEffect(() => {
    if (!open) return
    function onClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open, setOpen])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!locked) setOpen(!open)
        }}
        disabled={locked}
        title={
          locked ? "Preset is chosen when a chat starts" : "Sandbox preset"
        }
        className="flex h-8 max-w-[11rem] items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:hover:bg-transparent"
      >
        <Package className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        {locked ? null : <ChevronDown className="size-3 opacity-60" />}
      </button>
      {open && !locked ? (
        <div className="absolute bottom-10 left-0 z-10 min-w-52 overflow-hidden rounded-2xl border border-black/[0.06] bg-popover p-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] dark:border-white/10">
          <div className="px-3 pt-1.5 pb-1 text-xs text-muted-foreground">
            Preset
          </div>
          <button
            type="button"
            onClick={() => {
              onSelect("")
              setOpen(false)
            }}
            className="flex w-full items-center justify-between gap-6 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
          >
            <span>Default</span>
            {!value ? <Check className="size-4 shrink-0" /> : null}
          </button>
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onSelect(preset.id)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between gap-6 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
            >
              <span className="min-w-0 truncate">{preset.name}</span>
              {preset.id === value ? (
                <Check className="size-4 shrink-0" strokeWidth={2.25} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Pill<T extends string>({
  header,
  value,
  options,
  formatTrigger,
  formatOption,
  open,
  setOpen,
  onSelect,
  triggerClassName,
}: {
  header: string
  value: T
  options: readonly T[]
  formatTrigger: (v: T) => string
  formatOption: (v: T) => string
  open: boolean
  setOpen: (v: boolean) => void
  onSelect: (v: T) => void
  triggerClassName?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open, setOpen])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-foreground transition-colors hover:bg-muted",
          triggerClassName
        )}
      >
        {formatTrigger(value)}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          className="opacity-60"
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 bottom-10 min-w-44 overflow-hidden rounded-2xl border border-black/[0.06] bg-popover p-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] dark:border-white/10">
          <div className="px-3 pt-1.5 pb-1 text-xs text-muted-foreground">
            {header}
          </div>
          {options.map((opt) => {
            const selected = opt === value
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onSelect(opt)
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between gap-6 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
              >
                <span>{formatOption(opt)}</span>
                {selected ? (
                  <Check className="size-4 shrink-0" strokeWidth={2.25} />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
