"use client"

import { Check, ChevronDown, Package } from "lucide-react"
import { type ButtonHTMLAttributes, useRef } from "react"

import {
  chipTrigger,
  popoverHeading,
  popoverItem,
  popoverPanel,
} from "@/components/chat/control-styles"
import type { Id } from "@/convex/_generated/dataModel"
import { useClickOutside } from "@/hooks/use-click-outside"
import { cn } from "@/lib/shared/utils"

type SandboxPresetOption = {
  id: Id<"sandboxPresets">
  name: string
}

/** Round icon button for the composer rows; the app-wide square icon button
 * lives in `components/ui/icon-button`. */
export function ComposerIconButton({
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

export function PresetPill({
  activeLabel,
  locked,
  menuPlacement = "up",
  onSelect,
  open,
  presets,
  setOpen,
  value,
}: {
  activeLabel?: string
  locked?: boolean
  menuPlacement?: "up" | "down"
  onSelect: (value: Id<"sandboxPresets"> | "") => void
  open: boolean
  presets: SandboxPresetOption[]
  setOpen: (value: boolean) => void
  value: Id<"sandboxPresets"> | ""
}) {
  const ref = useRef<HTMLDivElement>(null)
  const selected = presets.find((preset) => preset.id === value)
  const label = selected?.name ?? activeLabel ?? "Auto environment"
  useClickOutside(ref, open, () => setOpen(false))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!locked) setOpen(!open)
        }}
        disabled={locked}
        aria-haspopup="menu"
        aria-expanded={open && !locked}
        title={
          locked ? "Preset is chosen when a chat starts" : "Sandbox preset"
        }
        className={cn(
          chipTrigger,
          "max-w-[11rem]",
          selected || activeLabel
            ? "text-foreground/80"
            : "text-muted-foreground"
        )}
      >
        <Package className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        {locked ? null : <ChevronDown className="size-3 opacity-60" />}
      </button>
      {open && !locked ? (
        <div
          className={cn(
            popoverPanel,
            "right-0 max-h-80 min-w-52 overflow-y-auto sm:right-auto sm:left-0",
            menuPlacement === "down" ? "top-10" : "bottom-10"
          )}
        >
          <div className={popoverHeading}>Preset</div>
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onSelect(preset.id)
                setOpen(false)
              }}
              className={popoverItem}
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
  menuPlacement = "up",
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
  menuPlacement?: "up" | "down"
  open: boolean
  setOpen: (v: boolean) => void
  onSelect: (v: T) => void
  triggerClassName?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(chipTrigger, "gap-1 text-foreground", triggerClassName)}
      >
        {formatTrigger(value)}
        <ChevronDown className="size-3 opacity-60" />
      </button>
      {open ? (
        <div
          className={cn(
            popoverPanel,
            "right-0",
            menuPlacement === "down" ? "top-10" : "bottom-10"
          )}
        >
          <div className={popoverHeading}>{header}</div>
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
                className={popoverItem}
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

export function ThinkingSpeedPill<
  TThinking extends string,
  TSpeed extends string,
>({
  thinking,
  thinkingOptions,
  formatThinking,
  onSelectThinking,
  speed,
  speedOptions,
  formatSpeed,
  onSelectSpeed,
  open,
  setOpen,
  menuPlacement = "up",
}: {
  thinking: TThinking
  thinkingOptions: readonly TThinking[]
  formatThinking: (v: TThinking) => string
  onSelectThinking: (v: TThinking) => void
  speed: TSpeed
  speedOptions: readonly TSpeed[]
  formatSpeed: (v: TSpeed) => string
  onSelectSpeed: (v: TSpeed) => void
  open: boolean
  setOpen: (v: boolean) => void
  menuPlacement?: "up" | "down"
}) {
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(chipTrigger, "gap-1.5 text-foreground")}
      >
        <span className="text-foreground/80">{formatThinking(thinking)}</span>
        <span aria-hidden className="text-muted-foreground/50">
          ·
        </span>
        <span className="text-muted-foreground">{formatSpeed(speed)}</span>
        <ChevronDown className="size-3 opacity-60" />
      </button>
      {open ? (
        <div
          className={cn(
            popoverPanel,
            "right-0 min-w-52",
            menuPlacement === "down" ? "top-10" : "bottom-10"
          )}
        >
          <div className={popoverHeading}>Thinking</div>
          {thinkingOptions.map((opt) => {
            const selected = opt === thinking
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onSelectThinking(opt)
                  setOpen(false)
                }}
                className={cn(popoverItem, "pl-5")}
              >
                <span>{formatThinking(opt)}</span>
                {selected ? (
                  <Check className="size-4 shrink-0" strokeWidth={2.25} />
                ) : null}
              </button>
            )
          })}
          <div className="my-1 h-px bg-border/60" />
          <div className={cn(popoverHeading, "pt-1")}>Speed</div>
          {speedOptions.map((opt) => {
            const selected = opt === speed
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onSelectSpeed(opt)
                  setOpen(false)
                }}
                className={cn(popoverItem, "pl-5")}
              >
                <span>{formatSpeed(opt)}</span>
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
