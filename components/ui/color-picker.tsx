"use client"

import { Popover } from "@base-ui/react/popover"
import { useEffect, useRef, useState } from "react"

import { buttonVariants } from "@/components/ui/button-variants"
import { popoverSurfaceClass } from "@/components/ui/surface"
import { hexToHsv, hsvToHex, type Hsv } from "@/lib/theme/color"
import { cn } from "@/lib/shared/utils"

const HUE_STRIP_GRADIENT =
  "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * Attaches window pointer listeners for a drag on `element`, reporting the
 * pointer position relative to the element's rect (captured at press time, so
 * the element must not move mid-drag). `onEnd` runs once on release.
 */
function trackDrag(
  element: HTMLElement,
  onMove: (x: number, y: number, rect: DOMRect) => void,
  onEnd?: () => void
) {
  const rect = element.getBoundingClientRect()
  const move = (event: PointerEvent) =>
    onMove(event.clientX, event.clientY, rect)
  const up = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    onEnd?.()
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", up)
}

/**
 * Accent colour picker: a swatch trigger that opens a portalled popup with a
 * saturation/value square and a hue slider. `onChange` fires continuously while
 * dragging (for live preview); `onCommit` fires on release (persist there).
 */
export function ColorPicker({
  value,
  onChange,
  onCommit,
  className,
  ariaLabel,
}: {
  value: string
  onChange: (hex: string) => void
  onCommit: (hex: string) => void
  className?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value))
  // Free-form text for the hex field so partial edits (e.g. "#12") aren't
  // clobbered; the square/slider keep it in sync with the canonical colour.
  const [hexText, setHexText] = useState(value)

  // Mirror hsv in a ref so drag handlers (whose closures are created once per
  // press) always read the latest hue/sat/val for the channels they leave alone.
  const hsvRef = useRef(hsv)
  hsvRef.current = hsv

  // Re-seed from the external value when the popup opens, so the handles reflect
  // the current colour without fighting a live drag while already open.
  useEffect(() => {
    if (open) {
      setHsv(hexToHsv(value))
      setHexText(value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function preview(next: Hsv) {
    setHsv(next)
    const hex = hsvToHex(next)
    setHexText(hex)
    onChange(hex)
  }

  function commit() {
    onCommit(hsvToHex(hsvRef.current))
  }

  const currentHex = hsvToHex(hsv)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={ariaLabel}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "tabular-nums",
          className
        )}
      >
        <span
          className="size-3.5 shrink-0 rounded-full ring-1 ring-foreground/15 ring-inset"
          style={{ backgroundColor: value }}
        />
        {value.toUpperCase()}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8}>
          <Popover.Popup
            className={cn(
              "z-50 flex w-56 flex-col gap-3 p-3 outline-none",
              popoverSurfaceClass
            )}
          >
            {/* Saturation (x) / value (y) square. */}
            <button
              type="button"
              aria-label="Saturation and brightness"
              onPointerDown={(event) => {
                event.preventDefault()
                trackDrag(
                  event.currentTarget,
                  (x, y, rect) =>
                    preview({
                      h: hsvRef.current.h,
                      s: clamp01((x - rect.left) / rect.width),
                      v: 1 - clamp01((y - rect.top) / rect.height),
                    }),
                  commit
                )
              }}
              className="relative h-40 w-full touch-none overflow-hidden rounded-lg"
              style={{
                backgroundColor: `hsl(${hsv.h} 100% 50%)`,
                backgroundImage:
                  "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
              }}
            >
              <span
                className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                style={{
                  left: `${hsv.s * 100}%`,
                  top: `${(1 - hsv.v) * 100}%`,
                  background: currentHex,
                }}
              />
            </button>

            {/* Hue slider. */}
            <button
              type="button"
              aria-label="Hue"
              onPointerDown={(event) => {
                event.preventDefault()
                trackDrag(
                  event.currentTarget,
                  (x, _y, rect) =>
                    preview({
                      ...hsvRef.current,
                      h: clamp01((x - rect.left) / rect.width) * 360,
                    }),
                  commit
                )
              }}
              className="relative h-3 w-full touch-none rounded-full"
              style={{ backgroundImage: HUE_STRIP_GRADIENT }}
            >
              <span
                className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                style={{
                  left: `${(hsv.h / 360) * 100}%`,
                  background: `hsl(${hsv.h} 100% 50%)`,
                }}
              />
            </button>

            {/* Hex readout / manual entry. */}
            <div className="flex items-center gap-2">
              <span
                className="size-6 shrink-0 rounded-md"
                style={{ background: currentHex }}
              />
              <input
                aria-label="Hex color"
                value={hexText}
                spellCheck={false}
                onChange={(event) => {
                  const next = event.target.value
                  setHexText(next)
                  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(next)) {
                    setHsv(hexToHsv(next))
                    onChange(next)
                    onCommit(next)
                  }
                }}
                className="h-8 w-full rounded-md border border-field bg-transparent px-2 font-mono text-xs text-foreground uppercase tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
