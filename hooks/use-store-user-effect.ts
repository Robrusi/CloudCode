"use client"

import { useUser } from "@clerk/nextjs"
import { useConvexAuth, useMutation } from "convex/react"
import { useEffect, useState } from "react"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

export function useStoreUserEffect() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const { user } = useUser()
  const storeUser = useMutation(api.users.store)
  const [storedUser, setStoredUser] = useState<{
    clerkUserId: string
    convexUserId: Id<"users">
  } | null>(null)

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      return
    }

    const clerkUserId = user.id
    let cancelled = false

    async function store() {
      const id = await storeUser()
      if (!cancelled) {
        setStoredUser({ clerkUserId, convexUserId: id })
      }
    }

    void store()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, storeUser, user?.id])

  const hasStoredCurrentUser = storedUser?.clerkUserId === user?.id

  return {
    isAuthenticated: isAuthenticated && hasStoredCurrentUser,
    isLoading: isLoading || (isAuthenticated && !hasStoredCurrentUser),
  }
}
