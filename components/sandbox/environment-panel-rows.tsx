"use client"

import { Eye, EyeOff, Plus, Trash2 } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useCallback } from "react"

import {
  maskedDots,
  type EnvVar,
  type LocalRow,
} from "@/components/sandbox/environment-panel-model"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { cardSurfaceClass } from "@/components/ui/surface"
import { cn } from "@/lib/shared/utils"

const nameInputClass = cn(
  "w-full min-w-0 border-0 bg-transparent p-0 outline-none",
  "text-[13px] font-medium text-foreground",
  "placeholder:font-medium placeholder:text-muted-foreground/40"
)

const valueInputClass = cn(
  "w-full min-w-0 border-0 bg-transparent p-0 outline-none",
  "text-[13px] text-muted-foreground",
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

export function EnvRow({
  onChange,
  onRemove,
  onToggleReveal,
  revealed,
  row,
  saving,
}: {
  onChange: (patch: Partial<EnvVar>) => void
  onRemove: () => void
  onToggleReveal: () => void
  revealed: boolean
  row: LocalRow
  saving: boolean
}) {
  return (
    <li className="group flex items-center gap-3 border-b border-border/50 px-4 py-3 transition-colors last:border-b-0 focus-within:bg-muted/30 hover:bg-muted/30">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Input
          variant="bare"
          aria-label="Variable name"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className={nameInputClass}
          onChange={(event) => onChange({ name: event.target.value })}
          spellCheck={false}
          value={row.name}
        />
        <Input
          variant="bare"
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
          disabled={saving}
        >
          {revealed ? (
            <EyeOff className="size-3.5" />
          ) : (
            <Eye className="size-3.5" />
          )}
        </RowIconButton>
        <RowIconButton
          label="Delete variable"
          onClick={onRemove}
          disabled={saving}
        >
          <Trash2 className="size-3.5" />
        </RowIconButton>
      </div>
    </li>
  )
}

export function DraftRow({
  name,
  onCancel,
  onChangeName,
  onChangeValue,
  onSubmit,
  value,
}: {
  name: string
  onCancel: () => void
  onChangeName: (value: string) => void
  onChangeValue: (value: string) => void
  onSubmit: () => void
  value: string
}) {
  const setNameInputRef = useCallback((node: HTMLInputElement | null) => {
    node?.focus()
  }, [])

  return (
    <li className="flex items-center gap-3 border-b border-border/50 bg-muted/30 px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Input
          ref={setNameInputRef}
          variant="bare"
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
        <Input
          variant="bare"
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
  disabled,
  label,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <IconButton
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      {children}
    </IconButton>
  )
}

export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        cardSurfaceClass
      )}
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-medium text-foreground/80">No secrets yet</p>
        <p className="text-[11px] text-muted-foreground">
          Add a variable to the sandbox&apos;s .env.local.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <Plus />
        Add variable
      </Button>
    </div>
  )
}
