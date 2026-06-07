"use client"

import { Check, Copy, KeyRound, Loader2, Pencil, Trash2, X } from "lucide-react"
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { ResizeHandle } from "@/components/resize-handle"
import { Button } from "@/components/ui/button"
import { IconButton as UiIconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import {
  SegmentedControl,
  type SegmentedOption,
} from "@/components/ui/segmented-control"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { cn } from "@/lib/utils"

type SshConnection = {
  id: string
  accessId: string
  label: string
  sshCommand: string
  expiresAt: number
  createdAt: number
}

type ExpiresValue = "15" | "60" | "480"

const EXPIRES_OPTIONS: SegmentedOption<ExpiresValue>[] = [
  { value: "15", label: "15 min" },
  { value: "60", label: "1 hr" },
  { value: "480", label: "8 hr" },
]

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.")
  }
  return data as T
}

type ParsedSshCommand = {
  user: string
  host: string
  port: string | null
  identityFile: string | null
  options: { key: string; value: string }[]
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "")
  }
  return tokens
}

function parseSshCommand(command: string): ParsedSshCommand | null {
  const tokens = tokenizeCommand(command.trim())
  if (tokens.length === 0 || tokens[0] !== "ssh") return null

  let port: string | null = null
  let identityFile: string | null = null
  const options: { key: string; value: string }[] = []
  let target: string | null = null

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === "-p") {
      port = tokens[++i] ?? null
    } else if (token === "-i") {
      identityFile = tokens[++i] ?? null
    } else if (token === "-o") {
      const raw = tokens[++i] ?? ""
      const eq = raw.indexOf("=")
      if (eq > 0) {
        options.push({ key: raw.slice(0, eq), value: raw.slice(eq + 1) })
      }
    } else if (!token.startsWith("-") && token.includes("@") && !target) {
      target = token
    }
  }

  if (!target) return null
  const at = target.lastIndexOf("@")
  return {
    user: target.slice(0, at),
    host: target.slice(at + 1),
    port,
    identityFile,
    options,
  }
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
}

function hostAlias(connection: SshConnection) {
  const base =
    slug(connection.label) || `key-${connection.accessId.slice(0, 6)}`
  return `cloudcode-${base}`
}

function buildSshConfig(parsed: ParsedSshCommand, alias: string): string {
  const lines = [
    `Host ${alias}`,
    `  HostName ${parsed.host}`,
    `  User ${parsed.user}`,
  ]
  if (parsed.port) lines.push(`  Port ${parsed.port}`)
  if (parsed.identityFile) lines.push(`  IdentityFile ${parsed.identityFile}`)
  for (const option of parsed.options) {
    lines.push(`  ${option.key} ${option.value}`)
  }
  return lines.join("\n")
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Expired"
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m left`
  if (minutes > 0) return `${minutes}m ${seconds}s left`
  return `${seconds}s left`
}

function useCopy() {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const copy = useCallback((value: string) => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => undefined)
  }, [])

  return { copied, copy }
}

export function SshPanel({
  open,
  sandboxId,
  onClose,
}: {
  open: boolean
  sandboxId: string | null
  onClose: () => void
}) {
  const isMobile = useIsMobile()
  const { width, resizing, onResizeStart, resetWidth } = useResizablePanel({
    storageKey: "cloudcode:sshPanelWidth",
    defaultWidth: 460,
    minWidth: 360,
    maxWidth: 760,
    edge: "left",
    enabled: !isMobile,
  })
  const [expires, setExpires] = useState<ExpiresValue>("60")
  const [connections, setConnections] = useState<SshConnection[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return
      try {
        const data = await fetchJson<{ connections: SshConnection[] }>(
          `/api/sandbox/ssh?${new URLSearchParams({ sandboxId })}`,
          { signal }
        )
        if (!signal?.aborted) {
          setConnections(data.connections)
          setError(null)
        }
      } catch (err) {
        if (!signal?.aborted) {
          setError(
            err instanceof Error ? err.message : "Failed to load SSH access."
          )
          setConnections([])
        }
      }
    },
    [sandboxId]
  )

  useEffect(() => {
    setConnections(null)
    setError(null)
  }, [sandboxId])

  useEffect(() => {
    if (!open || !sandboxId) return
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [open, refresh, sandboxId])

  useEffect(() => {
    if (!open || !connections?.length) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [connections?.length, open])

  const create = useCallback(async () => {
    if (!sandboxId || creating) return
    setCreating(true)
    setError(null)
    try {
      const count = connections?.length ?? 0
      await fetchJson("/api/sandbox/ssh", {
        method: "POST",
        body: JSON.stringify({
          sandboxId,
          expiresInMinutes: Number(expires),
          label: `Key ${count + 1}`,
        }),
      })
      await refresh()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create SSH access."
      )
    } finally {
      setCreating(false)
    }
  }, [connections?.length, creating, expires, refresh, sandboxId])

  const rename = useCallback(
    async (id: string, label: string) => {
      setConnections(
        (current) =>
          current?.map((c) => (c.id === id ? { ...c, label } : c)) ?? current
      )
      try {
        await fetchJson("/api/sandbox/ssh", {
          method: "PATCH",
          body: JSON.stringify({ id, label }),
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rename key.")
        void refresh()
      }
    },
    [refresh]
  )

  const remove = useCallback(
    async (id: string) => {
      if (!sandboxId || pendingId) return
      setPendingId(id)
      setError(null)
      try {
        await fetchJson("/api/sandbox/ssh", {
          method: "DELETE",
          body: JSON.stringify({ sandboxId, id }),
        })
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to revoke key.")
      } finally {
        setPendingId(null)
      }
    },
    [pendingId, refresh, sandboxId]
  )

  if (!open) return null

  const busy = creating || pendingId !== null
  const hasConnections = Boolean(connections && connections.length > 0)

  return (
    <aside
      className="fixed inset-0 z-40 flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border/60 bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:relative md:inset-auto md:z-auto md:w-[var(--panel-width)] md:shrink-0 md:pt-0 md:pb-0"
      style={{ "--panel-width": `${width}px` } as CSSProperties}
      data-sandbox-ssh
    >
      <ResizeHandle
        edge="left"
        resizing={resizing}
        onResizeStart={onResizeStart}
        onReset={resetWidth}
        ariaLabel="Resize SSH panel"
      />
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <span className="text-sm font-medium text-foreground/85">SSH</span>
        {busy ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <UiIconButton
            onClick={onClose}
            aria-label="Close SSH panel"
            title="Close SSH panel"
          >
            <X className="size-4" />
          </UiIconButton>
        </div>
      </header>

      {error ? (
        <div className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {connections === null ? (
          <LoadingState />
        ) : hasConnections ? (
          <div className="space-y-5">
            <div className="space-y-3">
              {connections.map((connection) => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  now={now}
                  deleting={pendingId === connection.id}
                  deleteDisabled={pendingId !== null}
                  onRename={(label) => void rename(connection.id, label)}
                  onDelete={() => void remove(connection.id)}
                />
              ))}
            </div>

            <NewConnection
              expires={expires}
              onExpiresChange={setExpires}
              creating={creating}
              disabled={!sandboxId}
              onGenerate={() => void create()}
            />

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Anyone with a key&apos;s command can reach the sandbox until it
              expires. Revoke keys you are done with.
            </p>
          </div>
        ) : (
          <EmptyState
            expires={expires}
            onExpiresChange={setExpires}
            creating={creating}
            disabled={!sandboxId}
            onGenerate={() => void create()}
          />
        )}
      </div>
    </aside>
  )
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {[0, 1].map((i) => (
        <div
          key={i}
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
        ssh ••••••••••@ssh.app.daytona.io
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
  const sshConfig = useMemo(() => {
    const parsed = parseSshCommand(connection.sshCommand)
    return parsed ? buildSshConfig(parsed, hostAlias(connection)) : null
  }, [connection])

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
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [editing, value])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = useCallback(() => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== value) onSave(next)
  }, [draft, onSave, value])

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
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
      onClick={() => setEditing(true)}
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
  const { copied, copy } = useCopy()
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
  const { copied, copy } = useCopy()
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

export default SshPanel
