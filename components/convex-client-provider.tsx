"use client"

import { useAuth } from "@clerk/nextjs"
import { ConvexReactClient } from "convex/react"
import { ConvexProviderWithClerk } from "convex/react-clerk"
import type { ReactNode } from "react"

if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL.")
}

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL)

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  )
}
