import { Button as ButtonPrimitive } from "@base-ui/react/button"
import type { VariantProps } from "class-variance-authority"

import { iconButtonVariants } from "@/components/ui/icon-button-variants"
import { cn } from "@/lib/shared/utils"

type IconButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof iconButtonVariants>

function IconButton({ className, size, ...props }: IconButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="icon-button"
      className={cn(iconButtonVariants({ size, className }))}
      {...props}
    />
  )
}

export { IconButton }
