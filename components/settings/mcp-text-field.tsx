"use client"

import { fieldLabel, inputClass } from "@/components/settings/shared"
import type { McpStringSetter } from "@/components/settings/mcp-form-types"
import { cn } from "@/lib/shared/utils"

export function McpTextField({
  ariaLabel,
  label,
  placeholder,
  value,
  onChange,
}: {
  ariaLabel: string
  label: string
  placeholder: string
  value: string
  onChange: McpStringSetter
}) {
  return (
    <label className={fieldLabel}>
      {label}
      <input
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(inputClass, "font-normal")}
      />
    </label>
  )
}
