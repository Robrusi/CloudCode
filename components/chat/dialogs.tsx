"use client"

import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { Id } from "@/convex/_generated/dataModel"

export function ChatDialogs({
  deleteBusy,
  deleteError,
  pendingDeleteDisplayTitle,
  pendingDeleteId,
  pendingSandboxDelete,
  resumeBillingNotice,
  onCancelDeleteChat,
  onCancelDeleteSandbox,
  onClearResumeBillingNotice,
  onConfirmDeleteChat,
  onConfirmDeleteSandbox,
  onOpenBillingSettings,
}: {
  deleteBusy: boolean
  deleteError: string | null
  pendingDeleteDisplayTitle: string | null
  pendingDeleteId: Id<"threads"> | null
  pendingSandboxDelete: boolean
  resumeBillingNotice: string | null
  onCancelDeleteChat: () => void
  onCancelDeleteSandbox: () => void
  onClearResumeBillingNotice: () => void
  onConfirmDeleteChat: () => void
  onConfirmDeleteSandbox: () => void
  onOpenBillingSettings: () => void
}) {
  return (
    <>
      {pendingDeleteId ? (
        <ConfirmDialog
          title="Delete chat?"
          description={
            pendingDeleteDisplayTitle
              ? `“${pendingDeleteDisplayTitle}” will be permanently deleted. This action cannot be undone.`
              : "This chat will be permanently deleted. This action cannot be undone."
          }
          confirmLabel="Delete"
          destructive
          busy={deleteBusy}
          error={deleteError ?? undefined}
          onCancel={onCancelDeleteChat}
          onConfirm={onConfirmDeleteChat}
        />
      ) : null}

      {pendingSandboxDelete ? (
        <ConfirmDialog
          title="Delete sandbox?"
          description="The Daytona sandbox and its filesystem will be permanently deleted. The chat history will stay."
          confirmLabel="Delete sandbox"
          destructive
          onCancel={onCancelDeleteSandbox}
          onConfirm={onConfirmDeleteSandbox}
        />
      ) : null}

      {resumeBillingNotice ? (
        <ConfirmDialog
          title="No credits remaining"
          description={resumeBillingNotice}
          cancelLabel="Close"
          confirmLabel="Open settings"
          confirmWhite
          onCancel={onClearResumeBillingNotice}
          onConfirm={() => {
            onClearResumeBillingNotice()
            onOpenBillingSettings()
          }}
        />
      ) : null}
    </>
  )
}
