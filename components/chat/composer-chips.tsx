"use client"

import { Check, ChevronDown } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"

import {
  chipTrigger,
  popoverItem,
  popoverPanel,
} from "@/components/chat/control-styles"
import { useClickOutside } from "@/hooks/use-click-outside"
import {
  MODEL_LABEL,
  MODELS,
  THINKING_LABEL,
  normalizeThinkingForModel,
  thinkingOptionsForModel,
  type Model,
  type Thinking,
} from "@/lib/chat/options"
import { cn } from "@/lib/shared/utils"

/** Label + right-aligned chip row in a composer "Details" list. */
export function DetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3">
      <span className="shrink-0 text-sm text-foreground/90">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  )
}

/** Chip + popover for a small fixed set of options. Matches the sidebar
 * thread context menu: a compact single-line menu, not a tall detail list. */
export function OptionChip<T extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string
  onChange: (value: T) => void
  options: Array<{ value: T; label: string }>
  value: T
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))
  const current = options.find((option) => option.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(chipTrigger, "gap-1.5 text-foreground")}
      >
        <span>{current?.label ?? value}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>
      {open ? (
        <div className={cn(popoverPanel, "top-10 right-0")}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={popoverItem}
            >
              <span className="whitespace-nowrap">{option.label}</span>
              {option.value === value ? (
                <Check className="size-4 shrink-0" strokeWidth={2.25} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ModelChip({
  model,
  thinking,
  onSelectModel,
  onSelectThinking,
  open,
  setOpen,
}: {
  model: Model
  thinking: Thinking
  onSelectModel: (value: Model) => void
  onSelectThinking: (value: Thinking) => void
  open: boolean
  setOpen: (value: boolean) => void
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
        <span>{MODEL_LABEL[model]}</span>
        <span className="text-muted-foreground">
          {THINKING_LABEL[thinking]}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>
      {open ? (
        <div className={cn(popoverPanel, "top-10 right-0 min-w-52")}>
          <div className="px-2.5 pt-1.5 pb-1 text-left text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
            Model
          </div>
          {MODELS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onSelectModel(option)
                const nextThinking = normalizeThinkingForModel(option, thinking)
                if (nextThinking !== thinking) {
                  onSelectThinking(nextThinking)
                }
              }}
              className={cn(popoverItem, "pl-5")}
            >
              <span>{MODEL_LABEL[option]}</span>
              {option === model ? (
                <Check className="size-4 shrink-0" strokeWidth={2.25} />
              ) : null}
            </button>
          ))}
          <div className="my-1 h-px bg-border/60" />
          <div className="px-2.5 pt-1 pb-1 text-left text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
            Thinking
          </div>
          {thinkingOptionsForModel(model).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onSelectThinking(option)
                setOpen(false)
              }}
              className={cn(popoverItem, "pl-5")}
            >
              <span>{THINKING_LABEL[option]}</span>
              {option === thinking ? (
                <Check className="size-4 shrink-0" strokeWidth={2.25} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
