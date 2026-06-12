"use client"

import type { AnchorHTMLAttributes, ReactNode } from "react"

import { IconButton as UiIconButton } from "@/components/ui/icon-button"
import { iconButtonVariants } from "@/components/ui/icon-button-variants"
import { cn } from "@/lib/shared/utils"

export function SandboxDesktopIconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <UiIconButton
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      {children}
    </UiIconButton>
  )
}

export function SandboxDesktopIconLink({
  children,
  label,
  className,
  ...props
}: {
  children: ReactNode
  label: string
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      aria-label={label}
      title={label}
      className={cn(iconButtonVariants(), className)}
      {...props}
    >
      {children}
    </a>
  )
}
