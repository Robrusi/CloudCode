import type { ComponentProps } from "react"

import { cn } from "@/lib/shared/utils"

function MenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<"button"> & { destructive?: boolean }) {
  return (
    <button
      type="button"
      data-slot="menu-item"
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors outline-none hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
        destructive &&
          "text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10",
        className
      )}
      {...props}
    />
  )
}

export { MenuItem }
