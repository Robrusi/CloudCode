"use client"

import { type ReactNode, type Ref } from "react"

import { IconButton as UiIconButton } from "@/components/ui/icon-button"

export function TopBarIconButton({
  active,
  ariaExpanded,
  ariaHasPopup,
  children,
  disabled,
  label,
  onClick,
  onFocus,
  onPointerDown,
  onPointerEnter,
  ref,
}: {
  active?: boolean
  ariaExpanded?: boolean
  ariaHasPopup?: "dialog" | "grid" | "listbox" | "menu" | "tree" | boolean
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
  onFocus?: () => void
  onPointerDown?: () => void
  onPointerEnter?: () => void
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <UiIconButton
      ref={ref}
      onClick={onClick}
      onFocus={onFocus}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      aria-label={label}
      title={label}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      aria-pressed={active}
      disabled={disabled}
      className="size-9 md:size-7"
    >
      {children}
    </UiIconButton>
  )
}
