import type { ReactNode } from "react"

import { cn } from "@/lib/shared/utils"

/**
 * Full-screen blueprint backdrop shared by the signed-out and waitlist screens.
 * Keeps the viewfinder framing identical across every unauthenticated entry
 * point so they read as one surface.
 */
export function AuthBackdrop({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className="fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      {/* Blueprint grid, strongest behind the centered content. */}
      <div
        aria-hidden
        className="absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_38%,black,transparent)]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklab, var(--foreground) 7%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 7%, transparent) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          backgroundPosition: "center",
        }}
      />

      {/* Viewfinder corner marks. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-4 sm:inset-6"
      >
        <span className="absolute top-0 left-0 size-4 border-t border-l border-foreground/20" />
        <span className="absolute top-0 right-0 size-4 border-t border-r border-foreground/20" />
        <span className="absolute bottom-0 left-0 size-4 border-b border-l border-foreground/20" />
        <span className="absolute right-0 bottom-0 size-4 border-r border-b border-foreground/20" />
      </div>

      <main
        className={cn(
          "relative flex min-h-0 flex-1 flex-col items-center justify-center px-6",
          className
        )}
      >
        {children}
      </main>
    </div>
  )
}
