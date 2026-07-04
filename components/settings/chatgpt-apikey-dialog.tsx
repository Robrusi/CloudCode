"use client"

import { useEffect } from "react"

import { fieldHint, fieldLabel } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { popoverSurfaceClass } from "@/components/ui/surface"
import { cn } from "@/lib/shared/utils"

export function ChatGPTApiKeyDialog({
  value,
  busy,
  error,
  onValueChange,
  onConfirm,
  onCancel,
}: {
  value: string
  busy: boolean
  error: string
  onValueChange: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onCancel()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onCancel])

  const canConfirm = !busy && value.trim().length > 0

  return (
    <dialog
      open
      className="fixed inset-0 z-50 m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/40 p-4 backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      aria-modal="true"
      aria-label="Add OpenAI API key"
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
          "relative z-10 w-full max-w-md overflow-hidden p-5",
          popoverSurfaceClass
        )}
      >
        <div className="text-base font-medium text-foreground">
          Add OpenAI API key
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Authorize Codex runs with an OpenAI API key instead of a ChatGPT
          login. Create one at{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-[family-name:var(--font-mono)] text-[12px]">
            platform.openai.com/api-keys
          </code>
          .
        </p>
        <div className={cn(fieldLabel, "mt-4")}>
          <Input
            autoFocus
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label="OpenAI API key"
            value={value}
            disabled={busy}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canConfirm) onConfirm()
            }}
            placeholder="sk-..."
          />
          <span className={fieldHint}>
            Stored encrypted on your account and only decrypted to authorize a
            run.
          </span>
        </div>
        {error ? (
          <div className="mt-2 text-[11px] leading-4 text-destructive">
            {error}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={busy}
            className="text-muted-foreground"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
