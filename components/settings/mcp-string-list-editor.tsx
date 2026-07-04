"use client"

import { Plus } from "lucide-react"

import { McpRemoveRowButton } from "@/components/settings/mcp-remove-row-button"
import {
  appendMcpRowKey,
  useMcpRowKeys,
} from "@/components/settings/mcp-row-keys"
import { inputClass } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/shared/utils"

export function McpStringListEditor({
  addLabel,
  items,
  label,
  placeholder,
  onChange,
}: {
  addLabel: string
  items: string[]
  label: string
  placeholder: string
  onChange: (items: string[]) => void
}) {
  const rows = items.length ? items : [""]
  const canRemove = items.length > 0
  const rowKeysRef = useMcpRowKeys(rows.length)

  function addRow() {
    appendMcpRowKey(rowKeysRef)
    onChange([...items, ""])
  }

  function removeRow(index: number) {
    rowKeysRef.current.splice(index, 1)
    onChange(rows.filter((_, i) => i !== index))
  }

  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-foreground/80">{label}</div>
      {rows.map((item, index) => (
        <div
          key={rowKeysRef.current[index]}
          className="flex items-center gap-2"
        >
          <input
            aria-label={`${label} ${index + 1}`}
            value={item}
            onChange={(event) => {
              const next = rows.slice()
              next[index] = event.target.value
              onChange(next)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                addRow()
              }
            }}
            placeholder={placeholder}
            className={cn(
              inputClass,
              "font-[family-name:var(--font-mono)] text-xs"
            )}
          />
          <McpRemoveRowButton
            hidden={!canRemove}
            label={`Remove ${label} ${index + 1}`}
            onRemove={() => removeRow(index)}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={addRow}
        className="w-fit gap-1.5 text-muted-foreground"
      >
        <Plus className="size-3.5" />
        {addLabel}
      </Button>
    </div>
  )
}
