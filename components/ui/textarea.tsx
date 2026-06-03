import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const textareaVariants = cva(
  "w-full text-sm leading-relaxed transition-colors outline-none placeholder:text-muted-foreground/60 disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        default:
          "resize-none rounded-lg border border-border bg-background px-3 py-2 focus:border-ring focus:ring-3 focus:ring-ring/20",
        bare: "resize-none bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type TextareaProps = ComponentProps<"textarea"> &
  VariantProps<typeof textareaVariants>

function Textarea({ className, variant, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(textareaVariants({ variant, className }))}
      {...props}
    />
  )
}

export { Textarea, textareaVariants }
