"use client"

import { SignInButton } from "@clerk/nextjs"
import { GeistPixelSquare } from "geist/font/pixel"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

import { AuthBackdrop } from "@/components/auth/auth-backdrop"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/shared/utils"

const riseClass =
  "animate-[login-rise_0.7s_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none"

export function SignedOutScreen() {
  return (
    <AuthBackdrop className="pb-[12vh]">
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

      <p
        className={cn(
          "mt-6 text-center text-sm text-muted-foreground",
          riseClass,
          "[animation-delay:240ms]"
        )}
      >
        Don&apos;t have access yet?{" "}
        <Link
          href="/waitlist"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Join the waitlist
        </Link>
      </p>
    </AuthBackdrop>
  )
}
