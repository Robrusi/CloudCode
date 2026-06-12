"use client"

import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { Input } from "@/components/ui/input"
import { popoverSurfaceClass } from "@/components/ui/surface"
import { cn } from "@/lib/shared/utils"

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmationPhrase,
  busy,
  error,
  destructive,
  confirmWhite,
  onConfirm,
  onCancel,
}: {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** When set, the confirm button stays disabled until this exact phrase is typed. */
  confirmationPhrase?: string
  busy?: boolean
  error?: string
  destructive?: boolean
  confirmWhite?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typedPhrase, setTypedPhrase] = useState("")
  const confirmDisabled = Boolean(
    busy || (confirmationPhrase && typedPhrase !== confirmationPhrase)
  )

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onCancel()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onCancel])

  return (
    <dialog
      open
      className="fixed inset-0 z-50 m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/40 p-4 backdrop-blur-sm"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
    >
      <button
        type="button"
        aria-label="Cancel dialog"
        tabIndex={-1}
        className="absolute inset-0 cursor-default border-0 bg-transparent p-0"
        onClick={onCancel}
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-sm overflow-hidden p-5",
          popoverSurfaceClass
        )}
      >
        <div className="text-base font-medium text-foreground">{title}</div>
        {description ? (
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
        {confirmationPhrase ? (
          <label className="mt-4 grid gap-1.5 text-xs font-medium text-foreground/80">
            Type “{confirmationPhrase}” to confirm
            <Input
              value={typedPhrase}
              onChange={(event) => setTypedPhrase(event.target.value)}
              placeholder={confirmationPhrase}
              disabled={busy}
              autoFocus
            />
          </label>
        ) : null}
        {error ? (
          <div className="mt-2 text-xs leading-4 text-destructive">{error}</div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:pointer-events-none disabled:opacity-50",
              destructive
                ? "text-destructive-foreground bg-destructive hover:bg-destructive/90"
                : confirmWhite
                  ? "border border-border text-foreground/80 hover:bg-muted"
                  : "bg-foreground text-background hover:bg-foreground/90"
            )}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
