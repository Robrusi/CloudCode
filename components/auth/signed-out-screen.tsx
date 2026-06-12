"use client"

import { SignInButton } from "@clerk/nextjs"
import { GeistPixelSquare } from "geist/font/pixel"
import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/shared/utils"

const riseClass =
  "animate-[login-rise_0.7s_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none"

export function SignedOutScreen() {
  return (
    <div className="fixed inset-0 flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      {/* Blueprint grid, strongest behind the wordmark. */}
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

      <main className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-[12vh]">
        <h1
          className={cn(
            "text-5xl tracking-tight text-foreground sm:text-6xl",
            GeistPixelSquare.className,
            riseClass
          )}
        >
          Cloudcode
        </h1>

        <p
          className={cn(
            "mt-5 max-w-md text-center text-sm leading-6 text-balance text-muted-foreground",
            riseClass,
            "[animation-delay:80ms]"
          )}
        >
          A cloud workspace for Codex. Connect a repository, describe a change,
          and review the branches it ships from an isolated sandbox.
        </p>

        <SignInButton mode="modal">
          <Button
            type="button"
            size="lg"
            className={cn(
              "group/signin mt-10 px-6",
              riseClass,
              "[animation-delay:160ms]"
            )}
          >
            Sign in
            <ArrowRight
              data-icon="inline-end"
              className="transition-transform group-hover/signin:translate-x-0.5"
            />
          </Button>
        </SignInButton>
      </main>
    </div>
  )
}
