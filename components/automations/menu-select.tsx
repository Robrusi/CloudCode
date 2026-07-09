"use client"

import { Check, ChevronDown } from "lucide-react"
import { useCallback, useRef, useState } from "react"

import { popoverItem, popoverPanel } from "@/components/chat/control-styles"
import { useClickOutside } from "@/hooks/use-click-outside"
import { cn } from "@/lib/shared/utils"

/** The app's compact bordered field (matches BranchTargetChip / RepoChip). */
export const fieldBase =
  "h-8 w-full rounded-lg border border-field bg-background text-sm outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/20"

export type MenuSelectOption = { value: string; label: string }

/** Custom dropdown (never a native <select>): a field trigger plus a checked
 * menu, matching the app's popover menus. Shared by the automation trigger
 * and schedule chips. */
export function MenuSelect({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string
  onChange: (value: string) => void
  options: MenuSelectOption[]
  value: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))
  const current = options.find((option) => option.value === value)
  // Bring the selected row into view when the menu opens.
  const selectedRef = useCallback((node: HTMLButtonElement | null) => {
    node?.scrollIntoView({ block: "nearest" })
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
        className={cn(fieldBase, "flex items-center gap-2 px-2.5 text-left")}
      >
        <span className="min-w-0 flex-1 truncate">
          {current?.label ?? value}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/70 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <div
          className={cn(
            popoverPanel,
            "top-full left-0 z-20 mt-1 max-h-52 w-full overflow-y-auto"
          )}
        >
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                ref={selected ? selectedRef : undefined}
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cn(popoverItem, selected && "bg-muted")}
              >
                <span className="min-w-0 truncate">{option.label}</span>
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
