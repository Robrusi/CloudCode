"use client"

import { useLayoutEffect, useRef, useState } from "react"

import { cn } from "@/lib/shared/utils"

export type UnderlineTabOption<T extends string> = {
  /** Muted count rendered after the label; omit to show none. */
  count?: number
  label: string
  value: T
}

/** Text tabs with an underline indicator that slides between the labels.
 * Used for the Automations/Runs switch and the run status filters. */
export function UnderlineTabs<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: UnderlineTabOption<T>[]
  label: string
  className?: string
}) {
  const tabRefs = useRef<Partial<Record<T, HTMLButtonElement>>>({})
  const [indicator, setIndicator] = useState<{
    left: number
    width: number
  } | null>(null)

  // Measured (not CSS-only) so the underline can animate between labels of
  // different widths. Runs before paint, so the first render has no flash.
  // Re-measures when a count changes, since that shifts label widths.
  const widthSignature = options
    .map((option) => `${option.value}:${option.count ?? ""}`)
    .join(",")
  useLayoutEffect(() => {
    const element = tabRefs.current[value]
    if (element) {
      setIndicator({ left: element.offsetLeft, width: element.offsetWidth })
    }
  }, [value, widthSignature])

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("relative flex items-center gap-6", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          ref={(element) => {
            tabRefs.current[option.value] = element ?? undefined
          }}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex shrink-0 items-baseline gap-1.5 pb-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
            value === option.value
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
          {option.count ? (
            <span className="text-xs font-normal text-muted-foreground/70 tabular-nums">
              {option.count}
            </span>
          ) : null}
        </button>
      ))}
      <span
        aria-hidden
        className={cn(
          "absolute bottom-0 h-0.5 rounded-full bg-foreground transition-[left,width] duration-200 ease-out motion-reduce:transition-none",
          !indicator && "opacity-0"
        )}
        style={
          indicator
            ? { left: indicator.left, width: indicator.width }
            : undefined
        }
      />
    </div>
  )
}
