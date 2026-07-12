"use client"

import { Check, ChevronDown, GitBranch, GitBranchPlus } from "lucide-react"
import { useCallback, useRef } from "react"

import {
  chipTrigger,
  popoverHeading,
  popoverItem,
  popoverPanel,
} from "@/components/chat/control-styles"
import {
  BRANCH_MODE_LABEL,
  BRANCH_MODES,
  type BranchMode,
} from "@/lib/chat/options"
import { useClickOutside } from "@/hooks/use-click-outside"
import { cn } from "@/lib/shared/utils"

export function BranchTargetChip({
  baseBranch,
  branchName,
  locked,
  menuPlacement = "up",
  mode,
  onChangeBranchName,
  onChangeMode,
  open,
  setOpen,
}: {
  baseBranch?: string
  branchName: string
  locked?: boolean
  menuPlacement?: "up" | "down"
  mode: BranchMode
  onChangeBranchName: (name: string) => void
  onChangeMode: (mode: BranchMode) => void
  open: boolean
  setOpen: (value: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const focusInputRef = useCallback((node: HTMLInputElement | null) => {
    node?.focus()
  }, [])
  useClickOutside(ref, open, () => setOpen(false))

  const baseLabel = baseBranch?.trim() || "default branch"
  const trimmedName = branchName.trim()
  const TriggerIcon = mode === "base" ? GitBranch : GitBranchPlus
  const triggerLabel =
    mode === "custom"
      ? trimmedName || BRANCH_MODE_LABEL.auto
      : BRANCH_MODE_LABEL[mode]

  const descriptions: Record<BranchMode, string> = {
    auto: "Generated name",
    base: `Commit to ${baseLabel}`,
    custom: "Name it yourself",
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!locked) setOpen(!open)
        }}
        disabled={locked}
        aria-haspopup="dialog"
        aria-expanded={open && !locked}
        title={
          locked
            ? "Branch target is locked once a chat starts"
            : "Where this run's work lands"
        }
        className={cn(chipTrigger, "max-w-[12rem] text-foreground/80")}
      >
        <TriggerIcon className="size-3.5 shrink-0" />
        <span className="truncate">{triggerLabel}</span>
        {locked ? null : <ChevronDown className="size-3 opacity-60" />}
      </button>
      {open && !locked ? (
        <div
          className={cn(
            popoverPanel,
            "right-0 w-64 sm:right-auto sm:left-0",
            menuPlacement === "down" ? "top-10" : "bottom-10"
          )}
        >
          <div className={popoverHeading}>Branch</div>
          {BRANCH_MODES.map((option) => {
            const active = option === mode
            return (
              <div key={option}>
                <button
                  type="button"
                  onClick={() => {
                    onChangeMode(option)
                    if (option !== "custom") setOpen(false)
                  }}
                  className={cn(popoverItem, "items-start gap-3 py-2")}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-foreground">
                      {BRANCH_MODE_LABEL[option]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {descriptions[option]}
                    </span>
                  </span>
                  {active ? (
                    <Check
                      className="mt-0.5 size-4 shrink-0"
                      strokeWidth={2.25}
                    />
                  ) : null}
                </button>
                {option === "custom" && mode === "custom" ? (
                  <div className="px-2 pt-0.5 pb-1.5">
                    <div className="flex h-8 items-center gap-1.5 rounded-lg border border-field bg-background px-2.5 text-xs focus-within:ring-3 focus-within:ring-ring/30">
                      <GitBranchPlus className="size-3.5 shrink-0 text-muted-foreground" />
                      <input
                        ref={focusInputRef}
                        aria-label="New branch name"
                        value={branchName}
                        onChange={(event) =>
                          onChangeBranchName(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()
                            setOpen(false)
                          }
                          if (event.key === "Escape") setOpen(false)
                        }}
                        placeholder="feature/my-branch"
                        spellCheck={false}
                        className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
