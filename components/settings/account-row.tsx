"use client"

import { useClerk, useUser } from "@clerk/nextjs"
import { Circle, Loader2, LogOut } from "lucide-react"
import NextImage from "next/image"
import { useState } from "react"

import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { fetchJson } from "@/lib/http/client-json"

export function AccountRow() {
  const clerk = useClerk()
  const { user } = useUser()
  const [signingOut, setSigningOut] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const title = user?.fullName || user?.username || "Account"

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await clerk.signOut()
    } catch (error) {
      console.warn("Unable to sign out.", error)
      setSigningOut(false)
    }
  }

  async function deleteAccount() {
    if (deleting) return
    setDeleting(true)
    setDeleteError("")
    try {
      await fetchJson(
        "/api/account",
        { method: "DELETE" },
        {
          fallbackError: "Unable to delete account.",
        }
      )

      try {
        await clerk.signOut()
      } catch {
        // The Clerk user is already gone; just leave the app.
        window.location.assign("/")
      }
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Unable to delete account."
      )
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        {user?.imageUrl ? (
          <NextImage
            src={user.imageUrl}
            alt=""
            width={20}
            height={20}
            unoptimized
            className="size-5 shrink-0 rounded-full"
          />
        ) : (
          <Circle className="size-5 shrink-0 text-foreground/80" />
        )}
        <div className="min-w-0 flex-1 text-sm font-medium text-foreground">
          {title}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-foreground/80"
          onClick={() => void signOut()}
          disabled={signingOut || deleting}
        >
          {signingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
          Log out
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setConfirmingDelete(true)}
          disabled={signingOut || deleting}
        >
          Delete account
        </Button>
      </div>
      {confirmingDelete ? (
        <ConfirmDialog
          title="Delete account?"
          description="This permanently deletes your account and everything associated with it: chats, sandboxes, presets, MCP servers, billing records, and the connected ChatGPT and GitHub credentials. This cannot be undone."
          confirmLabel="Delete account"
          confirmationPhrase="Delete account"
          destructive
          busy={deleting}
          error={deleteError}
          onCancel={() => {
            if (deleting) return
            setConfirmingDelete(false)
            setDeleteError("")
          }}
          onConfirm={() => void deleteAccount()}
        />
      ) : null}
    </div>
  )
}
