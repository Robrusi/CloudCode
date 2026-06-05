"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export type SegmentedOption<T extends string> = {
  value: T
  label?: ReactNode
  icon?: ReactNode
  ariaLabel?: string
  title?: string
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  fill,
  className,
  itemClassName,
}: {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  label?: string
  fill?: boolean
  className?: string
  itemClassName?: string
}) {
  return (
    <fieldset
      className={cn(
        "inline-flex h-7 items-center gap-0.5 rounded-lg border border-field bg-muted/40 p-0.5",
        fill && "flex w-full",
        className
      )}
    >
      {label ? <legend className="sr-only">{label}</legend> : null}
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.ariaLabel}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-6 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30",
              fill && "flex-1",
              active && "bg-background text-foreground shadow-xs",
              itemClassName
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </fieldset>
  )
}

export { SegmentedControl }
