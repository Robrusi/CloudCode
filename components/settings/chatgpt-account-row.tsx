"use client"

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Pencil,
  Trash2,
} from "lucide-react"

import {
  codexAccountSubtitle,
  codexAccountTitle,
} from "@/components/settings/chatgpt-model"
import { iconBtn } from "@/components/settings/shared"
import type { CodexAuthAccountStatus } from "@/lib/codex/auth-types"
import { cn } from "@/lib/shared/utils"

export function ChatGPTAccountRow({
  account,
  active,
  busy,
  editingDisabled,
  onDisconnect,
  onRename,
  onSelect,
}: {
  account: CodexAuthAccountStatus
  active: boolean
  busy: boolean
  editingDisabled: boolean
  onDisconnect: () => void
  onRename: () => void
  onSelect: () => void
}) {
  const title = codexAccountTitle(account)
  const invalid = Boolean(account.invalidatedAt)
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-xl px-2.5 py-2 transition-colors",
        active ? "bg-muted" : "hover:bg-muted/60",
        busy && "opacity-80"
      )}
    >
      <button
        type="button"
        aria-pressed={active}
        disabled={active || busy || editingDisabled}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:pointer-events-none"
      >
        {invalid ? (
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
        ) : active ? (
          <CheckCircle2 className="size-4 shrink-0 text-success" />
        ) : (
          <Circle className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">
            {title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {codexAccountSubtitle(account)}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className={iconBtn}
          disabled={busy || editingDisabled}
          title="Rename account"
          aria-label={`Rename ${title}`}
          onClick={onRename}
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(iconBtn, "hover:text-destructive")}
          disabled={busy || editingDisabled}
          title="Disconnect account"
          aria-label={`Disconnect ${title}`}
          onClick={onDisconnect}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
