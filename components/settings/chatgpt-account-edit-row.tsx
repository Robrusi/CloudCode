"use client"

import { Check, CheckCircle2, Circle, X } from "lucide-react"

import { codexAccountTitle } from "@/components/settings/chatgpt-model"
import { iconBtn, inputClass } from "@/components/settings/shared"
import type { CodexAuthAccountStatus } from "@/lib/codex/auth-types"
import { cn } from "@/lib/shared/utils"

export function ChatGPTAccountEditRow({
  account,
  active,
  draftDisplayName,
  renaming,
  onCancel,
  onDraftDisplayNameChange,
  onRename,
}: {
  account: CodexAuthAccountStatus
  active: boolean
  draftDisplayName: string
  renaming: boolean
  onCancel: () => void
  onDraftDisplayNameChange: (value: string) => void
  onRename: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-muted px-2.5 py-2">
      {active ? (
        <CheckCircle2 className="size-4 shrink-0 text-success" />
      ) : (
        <Circle className="size-4 shrink-0 text-muted-foreground" />
      )}
      <input
        className={cn(inputClass, "h-8")}
        value={draftDisplayName}
        maxLength={80}
        placeholder={codexAccountTitle(account)}
        disabled={renaming}
        aria-label="ChatGPT account name"
        onChange={(event) => onDraftDisplayNameChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onRename()
          } else if (event.key === "Escape") {
            onCancel()
          }
        }}
      />
      <button
        type="button"
        className={iconBtn}
        disabled={renaming}
        title="Save name"
        aria-label="Save ChatGPT account name"
        onClick={onRename}
      >
        <Check className="size-4" />
      </button>
      <button
        type="button"
        className={iconBtn}
        disabled={renaming}
        title="Cancel rename"
        aria-label="Cancel ChatGPT account rename"
        onClick={onCancel}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
