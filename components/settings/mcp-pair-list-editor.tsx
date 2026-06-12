"use client"

import { Plus } from "lucide-react"

import type { McpPair } from "@/components/settings/mcp-model"
import { McpRemoveRowButton } from "@/components/settings/mcp-remove-row-button"
import {
  appendMcpRowKey,
  useMcpRowKeys,
} from "@/components/settings/mcp-row-keys"
import { inputClass, navAction } from "@/components/settings/shared"
import { cn } from "@/lib/shared/utils"

export function McpPairListEditor({
  addLabel,
  items,
  label,
  leftPlaceholder,
  rightPlaceholder,
  secret,
  onChange,
}: {
  addLabel: string
  items: McpPair[]
  label: string
  leftPlaceholder: string
  rightPlaceholder: string
  secret?: boolean
  onChange: (items: McpPair[]) => void
}) {
  const rows = items.length ? items : [{ name: "", value: "" }]
  const canRemove = items.length > 0
  const rowKeysRef = useMcpRowKeys(rows.length)

  function addRow() {
    appendMcpRowKey(rowKeysRef)
    onChange([...items, { name: "", value: "" }])
  }

  function removeRow(index: number) {
    rowKeysRef.current.splice(index, 1)
    onChange(rows.filter((_, i) => i !== index))
  }

  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-foreground/80">{label}</div>
      {rows.map((item, index) => {
        const update = (field: "name" | "value", value: string) => {
          const next = rows.slice()
          next[index] = { ...next[index], [field]: value }
          onChange(next)
        }
        return (
          <div
            key={rowKeysRef.current[index]}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
          >
            <input
              aria-label={`${label} name ${index + 1}`}
              value={item.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder={leftPlaceholder}
              className={cn(
                inputClass,
                "font-[family-name:var(--font-mono)] text-xs"
              )}
            />
            <input
              aria-label={`${label} value ${index + 1}`}
              value={item.value}
              onChange={(event) => update("value", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  addRow()
                }
              }}
              placeholder={rightPlaceholder}
              type={secret ? "password" : undefined}
              className={cn(
                inputClass,
                "text-xs",
                !secret && "font-[family-name:var(--font-mono)]"
              )}
            />
            <McpRemoveRowButton
              hidden={!canRemove}
              label={`Remove ${label} ${index + 1}`}
              onRemove={() => removeRow(index)}
            />
          </div>
        )
      })}
      <button type="button" onClick={addRow} className={navAction}>
        <Plus className="size-3.5" />
        {addLabel}
      </button>
    </div>
  )
}
