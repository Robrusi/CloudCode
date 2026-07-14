"use client"

import { Loader2, Play } from "lucide-react"
import { useEffect, useState, type ChangeEvent } from "react"

import {
  automationTriggerLabel,
  type AutomationRecord,
} from "@/components/automations/model"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { manualEventFields } from "@/lib/automations/manual-event"
import { popoverSurfaceClass } from "@/components/ui/surface"
import { cn } from "@/lib/shared/utils"

export function RunEventAutomationDialog({
  automation,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  automation: AutomationRecord
  busy: boolean
  error?: string
  onCancel: () => void
  onConfirm: (values: Record<string, string>) => void
}) {
  const trigger = automation.trigger
  if (!trigger || trigger.kind === "cron") {
    throw new Error("Event test dialog requires an event automation.")
  }
  const fields = manualEventFields(trigger)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, ""]))
  )

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [busy, onCancel])

  const canRun = !busy && Object.values(values).some((value) => value.trim())

  return (
    <dialog
      open
      aria-label={`Test ${automation.name}`}
      aria-modal="true"
      className="fixed inset-0 z-50 m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/40 p-4 backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onCancel()
      }}
    >
      <button
        type="button"
        aria-label="Cancel test event"
        tabIndex={-1}
        className="absolute inset-0 cursor-default border-0 bg-transparent p-0"
        onClick={() => {
          if (!busy) onCancel()
        }}
      />
      <form
        className={cn(
          "relative z-10 flex max-h-[min(44rem,calc(100dvh-2rem))] w-full max-w-md flex-col overflow-hidden",
          popoverSurfaceClass
        )}
        onSubmit={(event) => {
          event.preventDefault()
          if (canRun) onConfirm(values)
        }}
      >
        <div className="border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2 text-base font-medium text-foreground">
            <span className="grid size-7 place-items-center rounded-lg bg-muted">
              <Play className="size-3.5" />
            </span>
            Test event
          </div>
          <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
            Enter sample values for{" "}
            <span className="text-foreground/80">
              {automationTriggerLabel(automation)}
            </span>
            . This starts a real run.
          </p>
        </div>

        <div className="min-h-0 space-y-3 overflow-y-auto px-5 py-4">
          {fields.map((field, index) => {
            const shared = {
              "aria-label": field.label,
              autoFocus: index === 0,
              disabled: busy,
              onChange: (
                event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
              ) => {
                const value = event.target.value
                setValues((current) => ({ ...current, [field.key]: value }))
              },
              placeholder: field.placeholder,
              value: values[field.key] ?? "",
            }
            return (
              <label
                key={field.key}
                className="grid gap-1.5 text-xs font-medium text-foreground/80"
              >
                {field.label}
                {field.multiline ? (
                  <Textarea
                    {...shared}
                    rows={3}
                    className="min-h-20 resize-y"
                  />
                ) : (
                  <Input {...shared} />
                )}
              </label>
            )
          })}
          {error ? (
            <p className="text-xs leading-4 text-destructive">{error}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!canRun}
            className="gap-1.5"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            Run test
          </Button>
        </div>
      </form>
    </dialog>
  )
}
