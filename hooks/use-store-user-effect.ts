"use client"

import { useUser } from "@clerk/nextjs"
import { useAction, useConvexAuth, useMutation } from "convex/react"
import { useEffect, useState } from "react"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

const freePlanEnsures = new Map<string, Promise<void>>()

export function useStoreUserEffect() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const { user } = useUser()
  const ensureFreePlan = useAction(api.billing.ensureCurrentUserFreePlan)
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
      try {
        let ensure = freePlanEnsures.get(clerkUserId)
        if (!ensure) {
          ensure = ensureFreePlan({}).then(() => undefined)
          freePlanEnsures.set(clerkUserId, ensure)
        }
        await ensure
      } catch (error) {
        console.warn("Unable to ensure signup billing plan.", error)
      } finally {
        freePlanEnsures.delete(clerkUserId)
      }

      if (!cancelled) {
        setStoredUser({ clerkUserId, convexUserId: id })
      }
    }

    void store()

    return () => {
      cancelled = true
    }
  }, [ensureFreePlan, isAuthenticated, storeUser, user?.id])

  const hasStoredCurrentUser = storedUser?.clerkUserId === user?.id

  return {
    isAuthenticated: isAuthenticated && hasStoredCurrentUser,
    isLoading: isLoading || (isAuthenticated && !hasStoredCurrentUser),
  }
}
