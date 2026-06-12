"use client"

import { Check, Copy, KeyRound, Loader2, Pencil, Trash2 } from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import {
  EXPIRES_OPTIONS,
  buildSshConfigForConnection,
  formatRemaining,
  type ExpiresValue,
  type SshConnection,
} from "@/components/sandbox/ssh-panel-model"
import { Button } from "@/components/ui/button"
import { IconButton as UiIconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { cn } from "@/lib/shared/utils"

export function SshPanelContent({
  connections,
  creating,
  deleteDisabled,
  disabled,
  expires,
  now,
  pendingId,
  onDelete,
  onExpiresChange,
  onGenerate,
  onRename,
}: {
  connections: SshConnection[] | null
  creating: boolean
  deleteDisabled: boolean
  disabled: boolean
  expires: ExpiresValue
  now: number
  pendingId: string | null
  onDelete: (id: string) => void
  onExpiresChange: (value: ExpiresValue) => void
  onGenerate: () => void
  onRename: (id: string, label: string) => void
}) {
  const hasConnections = Boolean(connections && connections.length > 0)

  if (connections === null) {
    return <LoadingState />
  }

  if (!hasConnections) {
    return (
      <EmptyState
        expires={expires}
        onExpiresChange={onExpiresChange}
        creating={creating}
        disabled={disabled}
        onGenerate={onGenerate}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {connections.map((connection) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            now={now}
            deleting={pendingId === connection.id}
            deleteDisabled={deleteDisabled}
            onRename={(label) => onRename(connection.id, label)}
            onDelete={() => onDelete(connection.id)}
          />
        ))}
      </div>

      <NewConnection
        expires={expires}
        onExpiresChange={onExpiresChange}
        creating={creating}
        disabled={disabled}
        onGenerate={onGenerate}
      />

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Anyone with a key&apos;s command can reach the sandbox until it expires.
        Revoke keys you are done with.
      </p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {["primary", "secondary"].map((row) => (
        <div
          key={row}
          className="space-y-2 rounded-lg border border-border/60 bg-background/40 p-3"
        >
          <div className="h-3.5 w-24 animate-pulse rounded bg-muted-foreground/15" />
          <div className="h-8 w-full animate-pulse rounded bg-muted-foreground/10" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  expires,
  onExpiresChange,
  creating,
  disabled,
  onGenerate,
}: {
  expires: ExpiresValue
  onExpiresChange: (value: ExpiresValue) => void
  creating: boolean
  disabled: boolean
  onGenerate: () => void
}) {
  return (
    <div className="flex min-h-full flex-col justify-center gap-7 py-6">
      <div className="space-y-2 text-center">
        <h2 className="text-base font-medium text-foreground">
          Connect over SSH
        </h2>
        <p className="mx-auto max-w-[19rem] text-xs leading-relaxed text-muted-foreground">
          Open a time-limited connection to this sandbox from your own machine:
          your terminal, VS Code, Cursor, or JetBrains.
        </p>
      </div>

      <div className="mx-auto w-full max-w-[19rem] rounded-lg border border-dashed border-border/70 bg-background/30 px-3 py-2.5 text-center font-mono text-xs text-muted-foreground/60 select-none">
        ssh **********@ssh.app.daytona.io
      </div>

      <GeneratorControls
        expires={expires}
        onExpiresChange={onExpiresChange}
        creating={creating}
        disabled={disabled}
        onGenerate={onGenerate}
        layout="stacked"
      />
    </div>
  )
}

function NewConnection({
  expires,
  onExpiresChange,
  creating,
  disabled,
  onGenerate,
}: {
  expires: ExpiresValue
  onExpiresChange: (value: ExpiresValue) => void
  creating: boolean
  disabled: boolean
  onGenerate: () => void
}) {
  return (
    <div className="space-y-3 border-t border-border/60 pt-4">
      <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        New connection
      </span>
      <GeneratorControls
        expires={expires}
        onExpiresChange={onExpiresChange}
        creating={creating}
        disabled={disabled}
        onGenerate={onGenerate}
        layout="row"
      />
    </div>
  )
}

function GeneratorControls({
  expires,
  onExpiresChange,
  creating,
  disabled,
  onGenerate,
  layout,
}: {
  expires: ExpiresValue
  onExpiresChange: (value: ExpiresValue) => void
  creating: boolean
  disabled: boolean
  onGenerate: () => void
  layout: "stacked" | "row"
}) {
  const button = (
    <Button size="sm" disabled={disabled || creating} onClick={onGenerate}>
      {creating ? <Loader2 className="animate-spin" /> : <KeyRound />}
      {layout === "stacked" ? "Generate SSH access" : "Generate"}
    </Button>
  )

  if (layout === "row") {
    return (
      <div className="flex items-center justify-between gap-2">
        <SegmentedControl
          value={expires}
          onChange={onExpiresChange}
          options={EXPIRES_OPTIONS}
          label="SSH token lifetime"
        />
        {button}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2">
        <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          Token lifetime
        </span>
        <SegmentedControl
          value={expires}
          onChange={onExpiresChange}
          options={EXPIRES_OPTIONS}
          label="SSH token lifetime"
        />
      </div>
      <div className="flex justify-center">{button}</div>
    </div>
  )
}

function ConnectionCard({
  connection,
  now,
  deleting,
  deleteDisabled,
  onRename,
  onDelete,
}: {
  connection: SshConnection
  now: number
  deleting: boolean
  deleteDisabled: boolean
  onRename: (label: string) => void
  onDelete: () => void
}) {
  const remainingMs = connection.expiresAt - now
  const expired = remainingMs <= 0
  const lowTime = !expired && remainingMs <= 5 * 60 * 1000
  const sshConfig = useMemo(
    () => buildSshConfigForConnection(connection),
    [connection]
  )

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-background/40">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <NameEditor
          value={connection.label}
          onSave={onRename}
          className="min-w-0 flex-1"
        />
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium tabular-nums",
            expired
              ? "text-destructive"
              : lowTime
                ? "text-amber-600 dark:text-amber-500"
                : "text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              expired
                ? "bg-destructive"
                : lowTime
                  ? "bg-amber-500"
                  : "bg-success"
            )}
          />
          {formatRemaining(remainingMs)}
        </span>
      </div>

      <div className="px-3">
        <CommandField
          value={connection.sshCommand}
          label="SSH command"
          dim={expired}
        />
      </div>

      <div className="flex items-center gap-1 px-2 py-1.5">
        {sshConfig ? (
          <CopyConfigButton config={sshConfig} />
        ) : (
          <span className="flex-1" />
        )}
        {sshConfig ? <span className="flex-1" /> : null}
        <DeleteControl
          deleting={deleting}
          disabled={deleteDisabled}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}

function NameEditor({
  value,
  onSave,
  className,
}: {
  value: string
  onSave: (label: string) => void
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const setInputRef = useCallback((node: HTMLInputElement | null) => {
    node?.focus()
    node?.select()
  }, [])

  const commit = useCallback(() => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== value) onSave(next)
  }, [draft, onSave, value])

  if (editing) {
    return (
      <Input
        ref={setInputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            setEditing(false)
          }
        }}
        aria-label="SSH key name"
        className={cn("h-7 px-2 text-sm", className)}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      className={cn(
        "group/name flex items-center gap-1.5 rounded-md py-0.5 text-left",
        className
      )}
      title="Rename"
    >
      <span
        className={cn(
          "truncate text-sm font-medium",
          value ? "text-foreground/85" : "text-muted-foreground italic"
        )}
      >
        {value || "Untitled"}
      </span>
      <Pencil className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover/name:text-muted-foreground" />
    </button>
  )
}

function DeleteControl({
  deleting,
  disabled,
  onDelete,
}: {
  deleting: boolean
  disabled: boolean
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  if (deleting) {
    return (
      <span className="inline-flex h-6 items-center gap-1.5 px-2 text-[11px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Revoking
      </span>
    )
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="px-1 text-[11px] text-muted-foreground">Revoke?</span>
        <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button
          size="xs"
          variant="destructive"
          disabled={disabled}
          onClick={() => {
            setConfirming(false)
            onDelete()
          }}
        >
          Revoke
        </Button>
      </span>
    )
  }

  return (
    <UiIconButton
      size="xs"
      disabled={disabled}
      aria-label="Revoke SSH key"
      title="Revoke SSH key"
      className="hover:text-destructive"
      onClick={() => setConfirming(true)}
    >
      <Trash2 className="size-3.5" />
    </UiIconButton>
  )
}

function CopyConfigButton({ config }: { config: string }) {
  const { copied, copy } = useCopyToClipboard()
  return (
    <Button
      size="xs"
      variant="ghost"
      className="text-muted-foreground"
      onClick={() => copy(config)}
    >
      {copied ? (
        <Check className="size-3.5 text-success" />
      ) : (
        <Copy className="size-3.5" />
      )}
      {copied ? "Copied" : "IDE config"}
    </Button>
  )
}

function CommandField({
  value,
  label,
  dim,
}: {
  value: string
  label: string
  dim?: boolean
}) {
  const { copied, copy } = useCopyToClipboard()
  return (
    <div className="relative">
      <pre
        className={cn(
          "overflow-x-auto rounded-md bg-muted/50 px-3 py-2.5 pr-10 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90 select-all",
          dim && "opacity-60"
        )}
      >
        {value}
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <UiIconButton
          size="xs"
          aria-label={copied ? "Copied" : `Copy ${label}`}
          title={copied ? "Copied" : "Copy"}
          onClick={() => copy(value)}
        >
          {copied ? (
            <Check className="size-3.5 text-success" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </UiIconButton>
      </div>
    </div>
  )
}
