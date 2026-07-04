"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import type { ComponentProps } from "react"

import { cn } from "@/lib/shared/utils"

type SliderRootProps = ComponentProps<typeof SliderPrimitive.Root>

type SliderProps = Omit<
  SliderRootProps,
  "value" | "defaultValue" | "onValueChange" | "onValueCommitted"
> & {
  value?: number
  defaultValue?: number
  onValueChange?: (value: number) => void
  onValueCommitted?: (value: number) => void
}

/** Single-thumb slider over the shared design tokens. */
function Slider({
  className,
  defaultValue,
  onValueChange,
  onValueCommitted,
  value,
  ...props
}: SliderProps) {
  const single = (next: number | readonly number[]) =>
    Array.isArray(next) ? next[0] : (next as number)

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={value}
      defaultValue={defaultValue}
      onValueChange={
        onValueChange ? (next) => onValueChange(single(next)) : undefined
      }
      onValueCommitted={
        onValueCommitted ? (next) => onValueCommitted(single(next)) : undefined
      }
      className={cn("w-full", className)}
      {...props}
    >
      <SliderPrimitive.Control className="flex w-full touch-none items-center py-1.5 select-none">
        <SliderPrimitive.Track className="relative h-1.5 w-full rounded-full bg-input">
          <SliderPrimitive.Indicator className="rounded-full bg-accent-solid" />
          <SliderPrimitive.Thumb className="size-4 rounded-full bg-background shadow-sm ring-1 ring-border transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[dragging]:ring-accent-solid/40" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
