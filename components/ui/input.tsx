import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const inputVariants = cva(
  "w-full min-w-0 text-sm transition-colors outline-none placeholder:text-muted-foreground/60 disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        default:
          "h-9 rounded-lg border border-border bg-background px-3 focus:border-ring focus:ring-3 focus:ring-ring/20",
        bare: "bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type InputProps = ComponentProps<"input"> & VariantProps<typeof inputVariants>

function Input({ className, variant, ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      className={cn(inputVariants({ variant, className }))}
      {...props}
    />
  )
}

export { Input, inputVariants }
