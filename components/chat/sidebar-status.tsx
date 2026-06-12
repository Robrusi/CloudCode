"use client"

import { LaptopMinimal } from "lucide-react"
import { useEffect, useState } from "react"

import type { SandboxState } from "@/components/chat/sandbox-types"
import { cn } from "@/lib/shared/utils"

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function BrailleSpinner({ className }: { className?: string }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(
      () => setFrame((current) => (current + 1) % BRAILLE_FRAMES.length),
      80
    )
    return () => clearInterval(id)
  }, [])
  return (
    <span
      aria-label="Agent running"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center font-mono text-lg leading-none tabular-nums",
        className
      )}
    >
      {BRAILLE_FRAMES[frame]}
    </span>
  )
}

export function SandboxDot({
  state,
  starting,
}: {
  state?: SandboxState
  starting?: boolean
}) {
  if (state === "deleted" || state === "error") return null
  const running = state === "running" || starting
  if (!running && state !== "stopped") return null
  return (
    <LaptopMinimal
      aria-label={running ? "Sandbox running" : "Sandbox paused"}
      className={cn(
        "size-4 shrink-0",
        running ? "text-success" : "text-muted-foreground/70"
      )}
    />
  )
}
