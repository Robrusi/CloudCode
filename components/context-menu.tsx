"use client"

import { MenuItem, menuPanelClass } from "@/components/ui/menu"
import { cn } from "@/lib/utils"

export type ContextMenuItem = {
  label: string
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        role="menu"
        tabIndex={-1}
        style={{ top: y, left: x }}
        className={cn("fixed z-50 min-w-44", menuPanelClass)}
      >
        {items.map((item) => (
          <MenuItem
            key={item.label}
            disabled={item.disabled}
            destructive={item.destructive}
            onClick={() => {
              item.onSelect()
              onClose()
            }}
          >
            {item.label}
          </MenuItem>
        ))}
      </div>
    </>
  )
}
