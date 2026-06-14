import type { Metadata } from "next"
import { Waitlist } from "@clerk/nextjs"
import Link from "next/link"

import { AuthBackdrop } from "@/components/auth/auth-backdrop"

export const metadata: Metadata = {
  title: "Waitlist",
  description: "Request access to Cloudcode.",
}

export default function WaitlistPage() {
  return (
    <AuthBackdrop className="gap-8 py-12">
      <Waitlist signInUrl="/" />

      <Link
        href="/"
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Back to sign in
      </Link>
    </AuthBackdrop>
  )
}
