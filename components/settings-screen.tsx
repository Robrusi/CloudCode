"use client"

import { useMutation, useQuery } from "convex/react"
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardPaste,
  CornerDownRight,
  ExternalLink,
  Globe,
  KeyRound,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { SegmentedControl } from "@/components/ui/segmented-control"
import { Switch } from "@/components/ui/switch"
import { cardSurfaceClass, popoverSurfaceClass } from "@/components/ui/surface"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type {
  CodexAuthAccountStatus,
  CodexAuthOverview,
} from "@/lib/codex-auth-types"
import { dedupeEnvVars, parseDotenv } from "@/lib/dotenv-parse"
import { cn } from "@/lib/utils"

const card = cn("overflow-hidden", cardSurfaceClass)

const cardRow = "flex items-center gap-3 px-3.5 py-3"

const cardDivider = "border-t border-border/60"

const sectionLabel =
  "text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase"

const navAction =
  "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"

const navPrimary =
  "inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:pointer-events-none disabled:opacity-50"

const navDestructive =
  "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"

const iconBtn =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm transition-colors outline-none placeholder:text-muted-foreground/50 focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:opacity-60"

const textareaClass =
  "w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-[family-name:var(--font-mono)] text-xs leading-5 transition-colors outline-none placeholder:text-muted-foreground/50 focus:border-ring focus:ring-3 focus:ring-ring/20"

const fieldLabel = "grid gap-1.5 text-xs font-medium text-foreground/80"

const fieldHint = "text-[11px] leading-4 font-normal text-muted-foreground"

const metaPill =
  "inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"

const statusBadge =
  "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium"

const statusOk = "text-success"

const statusIdle = "text-muted-foreground"

type GitHubAuthStatus = {
  app?: {
    accounts?: Array<{
      accountType: "Organization" | "User"
      avatarUrl?: string
      description?: string
      htmlUrl?: string
      id: string
      installationId?: string
      installed: boolean
      login: string
      repositorySelection?: string
    }>
    configured: boolean
    installationConfigured?: boolean
    installations: Array<{
      accountLogin: string
      accountType?: string
      installationId: string
      repositorySelection?: string
    }>
    organizationError?: string
    organizations?: Array<{
      avatarUrl?: string
      description?: string
      id: string
      login: string
    }>
    user:
      | { connected: false }
      | {
          connected: true
          email?: string
          githubUserId: string
          login: string
          name?: string
        }
    userAuthConfigured?: boolean
  }
  connected: boolean
  mode?: "app" | "none"
  username?: string | null
}

type SandboxPresetSecretRecord = {
  id: Id<"sandboxPresetSecrets">
  name: string
}

type SandboxPresetRecord = {
  createdAt: number
  daytonaSnapshot?: string
  environmentSlug?: string
  environments?: Array<{
    activeSandboxId?: string
    builtAt?: number
    environmentSlug: string
    id: Id<"sandboxPresetEnvironments">
    repoUrl: string
    status: "empty" | "building" | "ready" | "failed" | "stale"
    updatedAt: number
  }>
  id: Id<"sandboxPresets">
  installScript?: string
  mode?: "manual" | "auto"
  name: string
  pathInstallScript?: string
  secrets: SandboxPresetSecretRecord[]
  updatedAt: number
}

type McpToolPolicy = "auto" | "prompt" | "never"

type McpServerRecord = {
  args?: string[]
  bearerTokenEnvVar?: string
  command?: string
  cwd?: string
  description?: string
  enabled: boolean
  envVars?: string[]
  id: Id<"mcpServers">
  name: string
  secrets: Array<{
    id: Id<"mcpServerSecrets">
    kind: "env" | "httpHeader" | "envHttpHeader"
    name: string
  }>
  serverName: string
  startupTimeoutSec?: number
  toolTimeoutSec?: number
  tools: Array<{
    description?: string
    id: Id<"mcpServerTools">
    name: string
    policy: McpToolPolicy
    title?: string
  }>
  transport: "stdio" | "http"
  url?: string
}

export function SettingsScreen({
  authStatus,
  authError,
  githubStatus,
  githubAuthError,
  onCodexAuthChanged,
  onGitHubAuthChanged,
  sandboxPresets,
}: {
  authStatus: CodexAuthOverview | null
  authError: string
  githubStatus: GitHubAuthStatus | null
  githubAuthError: string
  onCodexAuthChanged: () => void | Promise<void>
  onGitHubAuthChanged: () => void | Promise<void>
  sandboxPresets: SandboxPresetRecord[]
}) {
  const detailedPresets = useQuery(api.sandboxPresets.listWithEnvironments)
  const presets = (detailedPresets ?? sandboxPresets) as SandboxPresetRecord[]
  const [mcpServers, setMcpServers] = useState<McpServerRecord[]>([])
  const [mcpLoading, setMcpLoading] = useState(true)
  const [mcpError, setMcpError] = useState("")

  const reloadMcpServers = useCallback(async () => {
    setMcpError("")
    try {
      const response = await fetch("/api/mcp/custom", {
        method: "GET",
      })
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
        servers?: McpServerRecord[]
      }
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to load MCP servers.")
      }
      setMcpServers(data.servers ?? [])
    } catch (error) {
      setMcpError(
        error instanceof Error ? error.message : "Unable to load MCP servers."
      )
      setMcpServers([])
    } finally {
      setMcpLoading(false)
    }
  }, [])

  useEffect(() => {
    void reloadMcpServers()
  }, [reloadMcpServers])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-2xl px-4 pt-10 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-6">
          <h1 className="text-2xl font-medium tracking-tight text-foreground/90">
            Settings
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Manage connected accounts, MCP connections, and Daytona presets.
          </p>

          <section className="mt-8 space-y-2">
            <h2 className={cn(sectionLabel, "px-1")}>Connections</h2>
            <div className={card}>
              <ChatGPTConnectionRow
                status={authStatus}
                authError={authError}
                onCodexAuthChanged={onCodexAuthChanged}
              />
              <GitHubConnectionRow
                status={githubStatus}
                error={githubAuthError}
                onGitHubAuthChanged={onGitHubAuthChanged}
              />
            </div>
          </section>

          <McpSettings
            error={mcpError}
            loading={mcpLoading}
            onReload={reloadMcpServers}
            servers={mcpServers}
          />
          <PresetSettings presets={presets} />
        </div>
      </div>
    </div>
  )
}

function ChatGPTConnectionRow({
  status,
  authError,
  onCodexAuthChanged,
}: {
  status: CodexAuthOverview | null
  authError: string
  onCodexAuthChanged: () => void | Promise<void>
}) {
  const [switchingProfile, setSwitchingProfile] = useState<string | null>(null)
  const [editingProfile, setEditingProfile] = useState<string | null>(null)
  const [draftDisplayName, setDraftDisplayName] = useState("")
  const [renamingProfile, setRenamingProfile] = useState<string | null>(null)
  const [disconnectingProfile, setDisconnectingProfile] = useState<
    string | null
  >(null)
  const [pendingDisconnectAccount, setPendingDisconnectAccount] =
    useState<CodexAuthAccountStatus | null>(null)
  const [switchError, setSwitchError] = useState("")
  const accounts = status?.accounts ?? []
  const activeProfile = status?.activeProfile ?? status?.profile ?? "default"
  const connected = Boolean(status?.exists || accounts.length > 0)
  const activeAccount = accounts.find(
    (account) => account.profile === activeProfile
  )
  const detail = connected
    ? activeAccount
      ? `Using ${codexAccountTitle(activeAccount)}`
      : "Connected. Codex runs are authorized with ChatGPT."
    : "Sign in with ChatGPT to authorize Codex runs."
  const visibleError = switchError || authError

  async function selectProfile(profile: string) {
    if (profile === activeProfile || switchingProfile || editingProfile) return

    setSwitchingProfile(profile)
    setSwitchError("")

    try {
      const res = await fetch("/api/codex-auth", {
        body: JSON.stringify({ profile }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }

      if (!res.ok) {
        throw new Error(data.error ?? "Unable to switch ChatGPT account.")
      }

      await onCodexAuthChanged()
    } catch (error) {
      setSwitchError(
        error instanceof Error
          ? error.message
          : "Unable to switch ChatGPT account."
      )
    } finally {
      setSwitchingProfile(null)
    }
  }

  function startRename(account: CodexAuthAccountStatus) {
    setEditingProfile(account.profile)
    setDraftDisplayName(account.displayName ?? "")
    setSwitchError("")
  }

  async function renameProfile(profile: string) {
    if (renamingProfile) return

    setRenamingProfile(profile)
    setSwitchError("")

    try {
      const res = await fetch("/api/codex-auth", {
        body: JSON.stringify({
          displayName: draftDisplayName,
          profile,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }

      if (!res.ok) {
        throw new Error(data.error ?? "Unable to rename ChatGPT account.")
      }

      await onCodexAuthChanged()
      setEditingProfile(null)
      setDraftDisplayName("")
    } catch (error) {
      setSwitchError(
        error instanceof Error
          ? error.message
          : "Unable to rename ChatGPT account."
      )
    } finally {
      setRenamingProfile(null)
    }
  }

  async function disconnectProfile(account: CodexAuthAccountStatus) {
    if (disconnectingProfile) return

    setPendingDisconnectAccount(null)
    setDisconnectingProfile(account.profile)
    setSwitchError("")

    try {
      const res = await fetch("/api/codex-auth", {
        body: JSON.stringify({ profile: account.profile }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }

      if (!res.ok) {
        throw new Error(data.error ?? "Unable to disconnect ChatGPT account.")
      }

      if (editingProfile === account.profile) {
        setEditingProfile(null)
        setDraftDisplayName("")
      }
      await onCodexAuthChanged()
    } catch (error) {
      setSwitchError(
        error instanceof Error
          ? error.message
          : "Unable to disconnect ChatGPT account."
      )
    } finally {
      setDisconnectingProfile(null)
    }
  }

  return (
    <div>
      <div className={cardRow}>
        <svg
          viewBox="0 0 256 260"
          preserveAspectRatio="xMidYMid"
          aria-hidden
          className="size-6 shrink-0 fill-current text-foreground/80"
        >
          <path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground/85">ChatGPT</div>
          <div className="text-xs text-muted-foreground">{detail}</div>
          {visibleError ? (
            <div className="mt-1 text-[11px] leading-4 text-destructive">
              {visibleError}
            </div>
          ) : null}
        </div>
        {connected ? (
          <form action="/api/codex-auth/login" method="get">
            <input type="hidden" name="profile" value={activeProfile} />
            <button type="submit" className={navAction}>
              <RefreshCw className="size-3.5" />
              Reconnect
            </button>
          </form>
        ) : null}
        <form action="/api/codex-auth/login" method="get">
          {connected ? <input type="hidden" name="add" value="1" /> : null}
          <button type="submit" className={connected ? navAction : navPrimary}>
            {connected ? <Plus className="size-3.5" /> : null}
            {connected ? "Add account" : "Connect"}
          </button>
        </form>
      </div>
      {accounts.length > 0 ? (
        <div className="border-t border-border/60 px-3.5 py-2">
          <div className="grid gap-1.5">
            {accounts.map((account) => {
              const active = account.profile === activeProfile
              const editing = editingProfile === account.profile
              const busy = Boolean(
                switchingProfile || renamingProfile || disconnectingProfile
              )
              const disconnecting = disconnectingProfile === account.profile
              const renaming = renamingProfile === account.profile
              const switching = switchingProfile === account.profile

              if (editing) {
                return (
                  <div
                    key={account.profile}
                    className="grid min-h-12 w-full grid-cols-[1rem_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-left text-foreground"
                  >
                    {active ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <Circle className="size-4 text-muted-foreground" />
                    )}
                    <input
                      className={cn(inputClass, "h-8")}
                      value={draftDisplayName}
                      maxLength={80}
                      placeholder={codexAccountTitle(account)}
                      disabled={renaming}
                      aria-label="ChatGPT account name"
                      onChange={(event) =>
                        setDraftDisplayName(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void renameProfile(account.profile)
                        } else if (event.key === "Escape") {
                          setEditingProfile(null)
                          setDraftDisplayName("")
                        }
                      }}
                    />
                    <button
                      type="button"
                      className={iconBtn}
                      disabled={renaming}
                      title="Save name"
                      aria-label="Save ChatGPT account name"
                      onClick={() => void renameProfile(account.profile)}
                    >
                      <Check className="size-4" />
                    </button>
                    <button
                      type="button"
                      className={iconBtn}
                      disabled={renaming}
                      title="Cancel rename"
                      aria-label="Cancel ChatGPT account rename"
                      onClick={() => {
                        setEditingProfile(null)
                        setDraftDisplayName("")
                      }}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )
              }

              return (
                <div
                  key={account.profile}
                  className={cn(
                    "grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg transition-colors",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                    busy && "opacity-80"
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={active}
                    disabled={active || busy || Boolean(editingProfile)}
                    onClick={() => void selectProfile(account.profile)}
                    className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 px-2.5 py-2 text-left disabled:pointer-events-none"
                  >
                    {active ? (
                      <CheckCircle2 className="size-4 text-success" />
                    ) : (
                      <Circle className="size-4" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {codexAccountTitle(account)}
                      </span>
                      <span className="block truncate text-xs">
                        {codexAccountSubtitle(account)}
                      </span>
                    </span>
                  </button>
                  <div className="mr-1 flex items-center gap-1">
                    <button
                      type="button"
                      className={iconBtn}
                      disabled={busy || Boolean(editingProfile)}
                      title="Rename account"
                      aria-label={`Rename ${codexAccountTitle(account)}`}
                      onClick={() => startRename(account)}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className={cn(iconBtn, "hover:text-destructive")}
                      disabled={busy || Boolean(editingProfile)}
                      title="Disconnect account"
                      aria-label={`Disconnect ${codexAccountTitle(account)}`}
                      onClick={() => setPendingDisconnectAccount(account)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-pressed={active}
                      disabled={active || busy || Boolean(editingProfile)}
                      onClick={() => void selectProfile(account.profile)}
                      className={cn(
                        metaPill,
                        "h-7 transition-colors disabled:pointer-events-none disabled:opacity-80",
                        active
                          ? "text-foreground/70"
                          : "text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
                      )}
                    >
                      {disconnecting
                        ? "Disconnecting"
                        : switching
                          ? "Switching"
                          : active
                            ? "Active"
                            : "Use"}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
      {pendingDisconnectAccount ? (
        <SettingsConfirmDialog
          title={`Disconnect ${codexAccountTitle(pendingDisconnectAccount)}?`}
          description="Codex runs will stop using this ChatGPT account."
          confirmLabel="Disconnect"
          destructive
          onCancel={() => setPendingDisconnectAccount(null)}
          onConfirm={() => void disconnectProfile(pendingDisconnectAccount)}
        />
      ) : null}
    </div>
  )
}

function codexAccountTitle(account: CodexAuthAccountStatus) {
  return (
    account.displayName ||
    account.accountEmail ||
    account.accountName ||
    (account.accountId
      ? `Account ${shortAccountId(account.accountId)}`
      : null) ||
    account.profile
  )
}

function codexAccountSubtitle(account: CodexAuthAccountStatus) {
  const label =
    account.accountEmail && account.accountName
      ? account.accountName
      : account.profile === "default"
        ? "Default profile"
        : account.profile

  return account.accountId
    ? `${label} - ${shortAccountId(account.accountId)}`
    : label
}

function shortAccountId(accountId: string) {
  return accountId.length <= 12
    ? accountId
    : `${accountId.slice(0, 4)}...${accountId.slice(-6)}`
}

function SettingsConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  onConfirm,
  onCancel,
}: {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
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

  return (
    <dialog
      open
      className="fixed inset-0 z-50 m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/40 p-4 backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault()
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
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors",
              destructive
                ? "text-destructive-foreground bg-destructive hover:bg-destructive/90"
                : "bg-foreground text-background hover:bg-foreground/90"
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}

function GitHubConnectionRow({
  status,
  error,
  onGitHubAuthChanged,
}: {
  status: GitHubAuthStatus | null
  error: string
  onGitHubAuthChanged: () => void | Promise<void>
}) {
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState("")
  const accounts = status?.app?.accounts ?? []
  const installations = status?.app?.installations ?? []
  const user = status?.app?.user
  const userLogin = user?.connected ? user.login : undefined
  const userReady = Boolean(user?.connected)
  const appReady = installations.length > 0
  const ready = userReady && appReady
  const installConfigured = status?.app?.installationConfigured !== false
  const userAuthConfigured = status?.app?.userAuthConfigured !== false
  const visibleError =
    disconnectError || error || status?.app?.organizationError

  const detail = ready
    ? `Authorized as @${userLogin}; App connected to ${installations
        .map((installation) => `@${installation.accountLogin}`)
        .join(", ")}.`
    : appReady
      ? `App connected to ${installations
          .map((installation) => `@${installation.accountLogin}`)
          .join(", ")}. Authenticate your GitHub user for git identity.`
      : !installConfigured || !userAuthConfigured
        ? "Set the GitHub App env vars to enable scoped repository access."
        : userReady
          ? `Authorized as @${userLogin}. Select repositories for your account or an organization below.`
          : "Select repositories from your GitHub account or an organization."

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect GitHub from this Cloudcode account? This revokes the GitHub authorization and removes saved installations from Cloudcode."
      )
    ) {
      return
    }

    setDisconnecting(true)
    setDisconnectError("")
    try {
      const response = await fetch("/api/github/auth", {
        method: "DELETE",
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to disconnect GitHub.")
      }
      if (data?.revokeError) {
        setDisconnectError(
          `Removed locally. GitHub revocation warning: ${data.revokeError}`
        )
      }
      await onGitHubAuthChanged()
    } catch (err) {
      setDisconnectError(
        err instanceof Error ? err.message : "Unable to disconnect GitHub."
      )
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className={cardDivider}>
      <div className={cardRow}>
        <svg
          viewBox="0 0 98 96"
          aria-hidden
          className="size-6 shrink-0 fill-current text-foreground/80"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364C83.907 89.389 98 70.973 98 49.217 98 22 76.162 0 48.854 0Z"
          />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground/85">GitHub</div>
          <div className="text-xs text-muted-foreground">{detail}</div>
          {visibleError ? (
            <div className="mt-1 text-[11px] leading-4 text-destructive">
              {visibleError}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!userReady ? (
            <form
              action={
                appReady
                  ? "/api/github/app/oauth/login"
                  : "/api/github/app/install"
              }
              method="get"
            >
              {appReady ? (
                <input type="hidden" name="next" value="settings" />
              ) : null}
              <button
                type="submit"
                disabled={disconnecting}
                className={navPrimary}
              >
                {appReady ? "Authenticate" : "Connect GitHub"}
              </button>
            </form>
          ) : null}
          {userReady ? (
            <form action="/api/github/app/install" method="get">
              <button
                type="submit"
                disabled={disconnecting}
                className={navAction}
              >
                Add org
              </button>
            </form>
          ) : null}
          {userReady ? (
            <button
              type="button"
              disabled={disconnecting}
              onClick={disconnect}
              className={navDestructive}
            >
              {disconnecting ? "Disconnecting" : "Disconnect"}
            </button>
          ) : null}
        </div>
      </div>

      {userReady && accounts.length > 0
        ? accounts.map((account) => {
            const targetId = /^\d+$/.test(account.id) ? account.id : undefined

            return (
              <div
                key={`${account.accountType}:${account.login}`}
                className={cn(cardRow, cardDivider)}
              >
                <span
                  aria-hidden
                  className="grid size-6 shrink-0 place-items-center text-muted-foreground/70"
                >
                  <CornerDownRight className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground/85">
                    @{account.login}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {account.accountType === "User"
                      ? "Personal account"
                      : "Organization"}
                  </div>
                </div>
                <span
                  className={cn(
                    statusBadge,
                    account.installed ? statusOk : statusIdle
                  )}
                >
                  {account.installed ? "Connected" : "Not connected"}
                </span>
                <form action="/api/github/app/install" method="get">
                  {targetId ? (
                    <input type="hidden" name="targetId" value={targetId} />
                  ) : null}
                  <button
                    type="submit"
                    disabled={disconnecting}
                    className={navAction}
                  >
                    {account.installed ? "Update repos" : "Select repos"}
                  </button>
                </form>
              </div>
            )
          })
        : null}
    </div>
  )
}

function McpSettings({
  error: loadError,
  loading,
  onReload,
  servers,
}: {
  error: string
  loading: boolean
  onReload: () => Promise<void>
  servers: McpServerRecord[]
}) {
  const updateToolPolicy = useMutation(api.mcpServers.updateToolPolicy)
  const [selectedId, setSelectedId] = useState<Id<"mcpServers"> | null>(null)
  const [creatingCustom, setCreatingCustom] = useState(false)
  const [transport, setTransport] = useState<"stdio" | "http">("stdio")
  const [name, setName] = useState("")
  const [command, setCommand] = useState("")
  const [url, setUrl] = useState("")
  const [bearerTokenEnvVar, setBearerTokenEnvVar] = useState("")
  const [cwd, setCwd] = useState("")
  const [argDraft, setArgDraft] = useState("")
  const [args, setArgs] = useState<string[]>([])
  const [envDraft, setEnvDraft] = useState({ name: "", value: "" })
  const [envVars, setEnvVars] = useState<
    Array<{ name: string; value: string }>
  >([])
  const [passthroughDraft, setPassthroughDraft] = useState("")
  const [passthroughVars, setPassthroughVars] = useState<string[]>([])
  const [headerDraft, setHeaderDraft] = useState({ name: "", value: "" })
  const [headers, setHeaders] = useState<
    Array<{ name: string; value: string }>
  >([])
  const [envHeaderDraft, setEnvHeaderDraft] = useState({ name: "", value: "" })
  const [envHeaders, setEnvHeaders] = useState<
    Array<{ name: string; value: string }>
  >([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const selected = servers.find((server) => server.id === selectedId) ?? null

  function resetCustomForm() {
    setCreatingCustom(false)
    setTransport("stdio")
    setName("")
    setCommand("")
    setUrl("")
    setBearerTokenEnvVar("")
    setCwd("")
    setArgDraft("")
    setArgs([])
    setEnvDraft({ name: "", value: "" })
    setEnvVars([])
    setPassthroughDraft("")
    setPassthroughVars([])
    setHeaderDraft({ name: "", value: "" })
    setHeaders([])
    setEnvHeaderDraft({ name: "", value: "" })
    setEnvHeaders([])
    setSaving(false)
    setError("")
  }

  function addValue(
    value: string,
    setter: (values: string[]) => void,
    values: string[],
    clear: () => void
  ) {
    const trimmed = value.trim()
    if (!trimmed) return
    setter([...values, trimmed])
    clear()
  }

  function addPair(
    pair: { name: string; value: string },
    setter: (values: Array<{ name: string; value: string }>) => void,
    values: Array<{ name: string; value: string }>,
    clear: () => void
  ) {
    const key = pair.name.trim()
    const value = pair.value.trim()
    if (!key || !value) return
    setter([...values, { name: key, value }])
    clear()
  }

  async function saveCustomServer() {
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/mcp/custom", {
        body: JSON.stringify({
          args,
          bearerTokenEnvVar,
          command,
          cwd,
          envHttpHeaders: envHeaders,
          envVars: passthroughVars,
          httpHeaders: headers,
          name,
          secrets: envVars,
          transport,
          url,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
        serverId?: Id<"mcpServers">
      }
      if (!response.ok || !data.serverId) {
        throw new Error(data.error ?? "Unable to save MCP server.")
      }
      setSelectedId(data.serverId)
      resetCustomForm()
      await onReload()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save MCP server."
      )
    } finally {
      setSaving(false)
    }
  }

  async function setPolicy(
    toolId: Id<"mcpServerTools">,
    policy: McpToolPolicy
  ) {
    setError("")
    try {
      await updateToolPolicy({ policy, toolId })
      await onReload()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update tool policy."
      )
    }
  }

  async function deleteSelected() {
    if (!selected) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/mcp/custom", {
        body: JSON.stringify({ serverId: selected.id }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      })
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to remove MCP server.")
      }
      setSelectedId(null)
      await onReload()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to remove MCP server."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-8 space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className={sectionLabel}>MCP Connections</h2>
        <button
          type="button"
          onClick={() => {
            resetCustomForm()
            setSelectedId(null)
            setCreatingCustom(true)
          }}
          className={navAction}
        >
          <Plus className="size-3.5" />
          Custom MCP
        </button>
      </div>

      <div className={card}>
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Loading MCP connections…
            </div>
          </div>
        ) : loadError ? (
          <div className={cardRow}>
            <Server className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground/85">
                Unable to load MCP connections
              </div>
              <div className="line-clamp-2 text-xs text-muted-foreground">
                {loadError}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void onReload()}
              className={navAction}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </button>
          </div>
        ) : servers.length ? (
          servers.map((server) => {
            const active = selected?.id === server.id
            const TransportIcon = server.transport === "http" ? Globe : Terminal
            const subtitle =
              server.transport === "stdio"
                ? [server.command, ...(server.args ?? [])]
                    .filter(Boolean)
                    .join(" ") || "stdio server"
                : server.url || "HTTP server"
            return (
              <button
                key={server.id}
                type="button"
                onClick={() => {
                  setSelectedId(server.id)
                  setCreatingCustom(false)
                }}
                aria-pressed={active}
                className={cn(
                  cardRow,
                  "group w-full border-b border-border/60 text-left transition-colors last:border-0 hover:bg-muted",
                  active ? "bg-muted text-foreground" : "text-foreground/80"
                )}
              >
                <TransportIcon className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground/90">
                    {server.name}
                  </div>
                  <div className="truncate font-[family-name:var(--font-mono)] text-xs text-muted-foreground">
                    {subtitle}
                  </div>
                </div>
                {server.tools.length ? (
                  <span
                    className={metaPill}
                    title={`${server.tools.length} tool${server.tools.length === 1 ? "" : "s"}`}
                  >
                    <Wrench className="size-3" />
                    {server.tools.length}
                  </span>
                ) : null}
                {server.secrets.length ? (
                  <span
                    className={metaPill}
                    title={`${server.secrets.length} secret${server.secrets.length === 1 ? "" : "s"}`}
                  >
                    <KeyRound className="size-3" />
                    {server.secrets.length}
                  </span>
                ) : null}
                <span className={metaPill}>
                  {server.transport === "http" ? "HTTP" : "STDIO"}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
              </button>
            )
          })
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <Server className="size-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground/85">
                No MCP servers connected
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect a custom MCP server to give Codex extra tools over STDIO
                or HTTP.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetCustomForm()
                setSelectedId(null)
                setCreatingCustom(true)
              }}
              className={navAction}
            >
              <Plus className="size-3.5" />
              Custom MCP
            </button>
          </div>
        )}
      </div>

      {creatingCustom ? (
        <div className={cn("mt-3", card)}>
          <div className={cn(cardRow, "border-b border-border/60")}>
            <Server className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground/85">
                Connect to a custom MCP
              </div>
              <a
                href="https://developers.openai.com/codex/mcp"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Docs <ExternalLink className="size-3" />
              </a>
            </div>
            <button
              type="button"
              onClick={resetCustomForm}
              aria-label="Close custom MCP editor"
              className={iconBtn}
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="grid gap-4 p-4">
            <label className={fieldLabel}>
              Name
              <input
                aria-label="MCP server name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="MCP server name"
                className={cn(inputClass, "font-normal")}
              />
            </label>

            <SegmentedControl
              fill
              label="MCP transport"
              value={transport}
              onChange={setTransport}
              options={[
                { label: "STDIO", value: "stdio" },
                { label: "Streamable HTTP", value: "http" },
              ]}
              className="h-9"
              itemClassName="h-8 text-sm"
            />

            {transport === "stdio" ? (
              <>
                <label className={fieldLabel}>
                  Command to launch
                  <input
                    aria-label="MCP command to launch"
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    placeholder="openai-dev-mcp serve-sqlite"
                    className={cn(inputClass, "font-normal")}
                  />
                </label>

                <McpStringListEditor
                  addLabel="Add argument"
                  draft={argDraft}
                  items={args}
                  label="Arguments"
                  placeholder="--project"
                  onAdd={() =>
                    addValue(argDraft, setArgs, args, () => setArgDraft(""))
                  }
                  onDraftChange={setArgDraft}
                  onRemove={(index) =>
                    setArgs(args.filter((_, itemIndex) => itemIndex !== index))
                  }
                />

                <McpPairListEditor
                  addLabel="Add environment variable"
                  draft={envDraft}
                  items={envVars}
                  label="Environment variables"
                  leftPlaceholder="Key"
                  rightPlaceholder="Value"
                  onAdd={() =>
                    addPair(envDraft, setEnvVars, envVars, () =>
                      setEnvDraft({ name: "", value: "" })
                    )
                  }
                  onDraftChange={setEnvDraft}
                  onRemove={(index) =>
                    setEnvVars(
                      envVars.filter((_, itemIndex) => itemIndex !== index)
                    )
                  }
                />

                <McpStringListEditor
                  addLabel="Add variable"
                  draft={passthroughDraft}
                  items={passthroughVars}
                  label="Environment variable passthrough"
                  placeholder="GITHUB_TOKEN"
                  onAdd={() =>
                    addValue(
                      passthroughDraft,
                      setPassthroughVars,
                      passthroughVars,
                      () => setPassthroughDraft("")
                    )
                  }
                  onDraftChange={setPassthroughDraft}
                  onRemove={(index) =>
                    setPassthroughVars(
                      passthroughVars.filter(
                        (_, itemIndex) => itemIndex !== index
                      )
                    )
                  }
                />

                <label className={fieldLabel}>
                  Working directory
                  <input
                    aria-label="MCP working directory"
                    value={cwd}
                    onChange={(event) => setCwd(event.target.value)}
                    placeholder="~/code"
                    className={cn(inputClass, "font-normal")}
                  />
                </label>
              </>
            ) : (
              <>
                <label className={fieldLabel}>
                  URL
                  <input
                    aria-label="MCP server URL"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://mcp.example.com/mcp"
                    className={cn(inputClass, "font-normal")}
                  />
                </label>
                <label className={fieldLabel}>
                  Bearer token env var
                  <input
                    aria-label="MCP bearer token environment variable"
                    value={bearerTokenEnvVar}
                    onChange={(event) =>
                      setBearerTokenEnvVar(event.target.value)
                    }
                    placeholder="MCP_BEARER_TOKEN"
                    className={cn(inputClass, "font-normal")}
                  />
                </label>
                <McpPairListEditor
                  addLabel="Add header"
                  draft={headerDraft}
                  items={headers}
                  label="Headers"
                  leftPlaceholder="Key"
                  rightPlaceholder="Value"
                  onAdd={() =>
                    addPair(headerDraft, setHeaders, headers, () =>
                      setHeaderDraft({ name: "", value: "" })
                    )
                  }
                  onDraftChange={setHeaderDraft}
                  onRemove={(index) =>
                    setHeaders(
                      headers.filter((_, itemIndex) => itemIndex !== index)
                    )
                  }
                />
                <McpPairListEditor
                  addLabel="Add variable"
                  draft={envHeaderDraft}
                  items={envHeaders}
                  label="Headers from environment variables"
                  leftPlaceholder="Header"
                  rightPlaceholder="Env var"
                  onAdd={() =>
                    addPair(envHeaderDraft, setEnvHeaders, envHeaders, () =>
                      setEnvHeaderDraft({ name: "", value: "" })
                    )
                  }
                  onDraftChange={setEnvHeaderDraft}
                  onRemove={(index) =>
                    setEnvHeaders(
                      envHeaders.filter((_, itemIndex) => itemIndex !== index)
                    )
                  }
                />
              </>
            )}

            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/60 px-3.5 py-2.5">
            <button
              type="button"
              onClick={resetCustomForm}
              disabled={saving}
              className={navAction}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveCustomServer}
              disabled={
                saving ||
                !name.trim() ||
                (transport === "stdio" ? !command.trim() : !url.trim())
              }
              className={navPrimary}
            >
              {saving ? "Saving" : "Save"}
            </button>
          </div>
        </div>
      ) : null}

      {selected ? (
        <div className={cn("mt-3", card)}>
          <div className={cn(cardRow, "border-b border-border/60")}>
            {selected.transport === "http" ? (
              <Globe className="size-5 shrink-0 text-muted-foreground" />
            ) : (
              <Terminal className="size-5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground/90">
                {selected.name}
              </div>
              <div className="truncate font-[family-name:var(--font-mono)] text-xs text-muted-foreground">
                {selected.transport === "http"
                  ? selected.url
                  : [selected.command, ...(selected.args ?? [])]
                      .filter(Boolean)
                      .join(" ")}
              </div>
            </div>
            <span className={metaPill}>
              {selected.transport === "http" ? "HTTP" : "STDIO"}
            </span>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Close MCP details"
              className={iconBtn}
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="grid gap-5 p-4">
            <div className="rounded-xl bg-muted/30 p-3">
              <dl className="grid gap-2 text-xs">
                <McpSummaryRow
                  label="Transport"
                  value={
                    selected.transport === "http" ? "Streamable HTTP" : "STDIO"
                  }
                />
                {selected.transport === "stdio" ? (
                  <>
                    {selected.command ? (
                      <McpSummaryRow
                        label="Command"
                        mono
                        value={[selected.command, ...(selected.args ?? [])]
                          .filter(Boolean)
                          .join(" ")}
                      />
                    ) : null}
                    {selected.cwd ? (
                      <McpSummaryRow
                        label="Directory"
                        mono
                        value={selected.cwd}
                      />
                    ) : null}
                    {selected.envVars?.length ? (
                      <McpSummaryRow
                        label="Env passthrough"
                        mono
                        value={selected.envVars.join(", ")}
                      />
                    ) : null}
                  </>
                ) : (
                  <>
                    {selected.url ? (
                      <McpSummaryRow label="URL" mono value={selected.url} />
                    ) : null}
                    {selected.bearerTokenEnvVar ? (
                      <McpSummaryRow
                        label="Bearer env"
                        mono
                        value={selected.bearerTokenEnvVar}
                      />
                    ) : null}
                  </>
                )}
              </dl>
              {selected.secrets.length ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border/60 pt-2.5">
                  {selected.secrets.map((secret) => (
                    <span key={secret.id} className={metaPill}>
                      <KeyRound className="size-3" />
                      {secret.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {selected.tools.length ? (
              <div className="grid gap-2">
                <div className="flex items-center gap-2 px-0.5 text-xs font-medium text-foreground/80">
                  <ShieldCheck className="size-3.5 text-muted-foreground" />
                  Tool policy
                </div>
                <div>
                  {selected.tools.map((tool) => (
                    <div
                      key={tool.id}
                      className="grid gap-2 border-b border-border/60 py-3 first:pt-1.5 last:border-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground/85">
                          {tool.title || tool.name}
                        </div>
                        <div className="truncate font-[family-name:var(--font-mono)] text-[11px] text-muted-foreground">
                          {tool.name}
                        </div>
                      </div>
                      <SegmentedControl
                        label={`Policy for ${tool.name}`}
                        value={tool.policy}
                        onChange={(policy) => void setPolicy(tool.id, policy)}
                        options={[
                          { label: "Auto", value: "auto" },
                          { label: "Ask", value: "prompt" },
                          { label: "Never", value: "never" },
                        ]}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-0.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0" />
                Codex has not reported tools for this server yet.
              </div>
            )}

            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3.5 py-2.5">
            <button
              type="button"
              onClick={deleteSelected}
              disabled={saving}
              className={navDestructive}
            >
              <Trash2 className="size-3.5" />
              Remove
            </button>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className={navAction}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function McpSummaryRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-words text-foreground/85",
          mono && "font-[family-name:var(--font-mono)]"
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function McpStringListEditor({
  addLabel,
  draft,
  items,
  label,
  placeholder,
  onAdd,
  onDraftChange,
  onRemove,
}: {
  addLabel: string
  draft: string
  items: string[]
  label: string
  placeholder: string
  onAdd: () => void
  onDraftChange: (value: string) => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-foreground/80">{label}</div>
      {items.map((item, index) => (
        <div key={`${item}:${index}`} className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-foreground/85">
            {item}
          </div>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className={cn(iconBtn, "hover:text-destructive")}
            aria-label={`Remove ${item}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <input
        aria-label={label}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            onAdd()
          }
        }}
        placeholder={placeholder}
        className={cn(
          inputClass,
          "font-[family-name:var(--font-mono)] text-xs"
        )}
      />
      <button type="button" onClick={onAdd} className={navAction}>
        <Plus className="size-3.5" />
        {addLabel}
      </button>
    </div>
  )
}

function McpPairListEditor({
  addLabel,
  draft,
  items,
  label,
  leftPlaceholder,
  rightPlaceholder,
  onAdd,
  onDraftChange,
  onRemove,
}: {
  addLabel: string
  draft: { name: string; value: string }
  items: Array<{ name: string; value: string }>
  label: string
  leftPlaceholder: string
  rightPlaceholder: string
  onAdd: () => void
  onDraftChange: (value: { name: string; value: string }) => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-foreground/80">{label}</div>
      {items.map((item, index) => (
        <div
          key={`${item.name}:${index}`}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
        >
          <div className="truncate rounded-lg border border-border bg-background px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-foreground/85">
            {item.name}
          </div>
          <div className="flex items-center gap-1.5 truncate rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            <KeyRound className="size-3 shrink-0" />
            ••••••••
          </div>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className={cn(iconBtn, "hover:text-destructive")}
            aria-label={`Remove ${item.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          aria-label={`${label} name`}
          value={draft.name}
          onChange={(event) =>
            onDraftChange({ ...draft, name: event.target.value })
          }
          placeholder={leftPlaceholder}
          className={cn(
            inputClass,
            "font-[family-name:var(--font-mono)] text-xs"
          )}
        />
        <input
          aria-label={`${label} value`}
          value={draft.value}
          onChange={(event) =>
            onDraftChange({ ...draft, value: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onAdd()
            }
          }}
          placeholder={rightPlaceholder}
          type="password"
          className={cn(inputClass, "text-xs")}
        />
      </div>
      <button type="button" onClick={onAdd} className={navAction}>
        <Plus className="size-3.5" />
        {addLabel}
      </button>
    </div>
  )
}

function PresetSettings({ presets }: { presets: SandboxPresetRecord[] }) {
  const createPreset = useMutation(api.sandboxPresets.create)
  const updatePreset = useMutation(api.sandboxPresets.update)
  const removePreset = useMutation(api.sandboxPresets.remove)
  const [selectedId, setSelectedId] = useState<Id<"sandboxPresets"> | null>(
    null
  )
  const selected = presets.find((preset) => preset.id === selectedId) ?? null
  const selectedIsAuto = selected?.mode === "auto"
  const [name, setName] = useState("")
  const [autoEnvironment, setAutoEnvironment] = useState(false)
  const [pathInstallScript, setPathInstallScript] = useState("")
  const [installScript, setInstallScript] = useState("")
  const [secretName, setSecretName] = useState("")
  const [secretValue, setSecretValue] = useState("")
  const [importMode, setImportMode] = useState(false)
  const [importText, setImportText] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)

  const parsedImport = useMemo(() => parseDotenv(importText), [importText])
  const importVars = useMemo(
    () => dedupeEnvVars(parsedImport.vars),
    [parsedImport]
  )

  function resetEditor() {
    setSelectedId(null)
    setCreating(false)
    setName("")
    setAutoEnvironment(false)
    setPathInstallScript("")
    setInstallScript("")
    setSecretName("")
    setSecretValue("")
    setImportMode(false)
    setImportText("")
    setError("")
  }

  function startNewPreset() {
    resetEditor()
    setCreating(true)
  }

  function selectPreset(preset: SandboxPresetRecord) {
    setSelectedId(preset.id)
    setCreating(false)
    setName(preset.name)
    setAutoEnvironment(preset.mode === "auto")
    setPathInstallScript(preset.pathInstallScript ?? "")
    setInstallScript(preset.installScript ?? "")
    setSecretName("")
    setSecretValue("")
    setImportMode(false)
    setImportText("")
    setError("")
  }

  async function savePreset() {
    setSaving(true)
    setError("")
    try {
      const mode = autoEnvironment ? "auto" : "manual"
      if (selected) {
        await updatePreset({
          installScript: installScript.trim() || undefined,
          mode,
          name,
          pathInstallScript: pathInstallScript.trim() || undefined,
          presetId: selected.id,
        })
      } else {
        const id = await createPreset({
          installScript: installScript.trim() || undefined,
          mode,
          name,
          pathInstallScript: pathInstallScript.trim() || undefined,
        })
        setSelectedId(id)
        setCreating(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save preset.")
    } finally {
      setSaving(false)
    }
  }

  async function deletePreset() {
    if (!selected || saving) return
    if (selectedIsAuto) {
      setError("Auto environment presets cannot be deleted.")
      return
    }
    setSaving(true)
    setError("")
    try {
      await removePreset({ presetId: selected.id })
      resetEditor()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete preset.")
    } finally {
      setSaving(false)
    }
  }

  async function ensurePresetId(): Promise<Id<"sandboxPresets"> | null> {
    if (selected?.id) return selected.id
    if (!name.trim()) {
      setError("Name the preset before adding secrets.")
      return null
    }
    const presetId = await createPreset({
      installScript: installScript.trim() || undefined,
      mode: autoEnvironment ? "auto" : "manual",
      name,
      pathInstallScript: pathInstallScript.trim() || undefined,
    })
    setSelectedId(presetId)
    setCreating(false)
    return presetId
  }

  async function saveSecret() {
    setSaving(true)
    setError("")
    try {
      const presetId = await ensurePresetId()
      if (!presetId) return
      const response = await fetch("/api/sandbox/presets/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: secretName,
          presetId,
          value: secretValue,
        }),
      })
      const data = (await response.json().catch(() => undefined)) as
        | { error?: unknown }
        | undefined

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Unable to save secret."
        )
      }
      setSecretName("")
      setSecretValue("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save secret.")
    } finally {
      setSaving(false)
    }
  }

  async function importSecrets() {
    if (importVars.length === 0) return
    setSaving(true)
    setError("")
    try {
      const presetId = await ensurePresetId()
      if (!presetId) return
      const response = await fetch("/api/sandbox/presets/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ presetId, secrets: importVars }),
      })
      const data = (await response.json().catch(() => undefined)) as
        | { error?: unknown; failed?: Array<{ error: string; name: string }> }
        | undefined

      if (!response.ok && response.status !== 207) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Unable to import secrets."
        )
      }

      const failed = data?.failed ?? []
      if (failed.length > 0) {
        setError(
          `Imported, but skipped ${failed.length}: ${failed
            .map((entry) => entry.name)
            .join(", ")}`
        )
      } else {
        setImportMode(false)
      }
      setImportText("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import secrets.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteSecret(secretId: Id<"sandboxPresetSecrets">) {
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/sandbox/presets/secrets", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secretId }),
      })
      const data = (await response.json().catch(() => undefined)) as
        | { error?: unknown }
        | undefined

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "Unable to delete secret."
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete secret.")
    } finally {
      setSaving(false)
    }
  }

  const isEditing = selected !== null || creating

  return (
    <section className="mt-8 space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className={sectionLabel}>Daytona Presets</h2>
        <button type="button" onClick={startNewPreset} className={navAction}>
          <Plus className="size-3.5" />
          New preset
        </button>
      </div>

      <div className={card}>
        {presets.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <Layers3 className="size-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground/85">
                No presets yet
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Create one to set up tools, install scripts, and secrets.
              </p>
            </div>
            <button
              type="button"
              onClick={startNewPreset}
              className={navAction}
            >
              <Plus className="size-3.5" />
              New preset
            </button>
          </div>
        ) : (
          presets.map((preset) => {
            const active = selected?.id === preset.id
            const readyEnvironments =
              preset.environments?.filter(
                (environment) => environment.status === "ready"
              ).length ?? 0
            const subtitle =
              [
                preset.mode === "auto" ? "Auto environment" : "",
                preset.mode === "auto" && readyEnvironments
                  ? `${readyEnvironments} ready`
                  : "",
                preset.pathInstallScript ? "PATH tools" : "",
                preset.installScript ? "repo install" : "",
                preset.secrets.length
                  ? `${preset.secrets.length} secret${preset.secrets.length === 1 ? "" : "s"}`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ") || "Cloudcode default environment"

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPreset(preset)}
                aria-pressed={active}
                className={cn(
                  cardRow,
                  "w-full border-b border-border/60 text-left transition-colors last:border-0 hover:bg-muted",
                  active ? "bg-muted text-foreground" : "text-foreground/80"
                )}
              >
                <Layers3 className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground/85">
                    {preset.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {subtitle}
                  </div>
                </div>
                {preset.pathInstallScript ? (
                  <span
                    className={metaPill}
                    title="Runs a PATH setup script from the sandbox home"
                  >
                    <Terminal className="size-3" />
                    PATH
                  </span>
                ) : null}
                {preset.installScript ? (
                  <span
                    className={metaPill}
                    title="Runs an install script from the repo root"
                  >
                    <Terminal className="size-3" />
                    script
                  </span>
                ) : null}
                {preset.secrets.length ? (
                  <span
                    className={metaPill}
                    title={`${preset.secrets.length} secret${preset.secrets.length === 1 ? "" : "s"}`}
                  >
                    <KeyRound className="size-3" />
                    {preset.secrets.length}
                  </span>
                ) : null}
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            )
          })
        )}
      </div>

      {isEditing ? (
        <div className={cn("mt-3", card)}>
          <div className={cn(cardRow, "border-b border-border/60")}>
            <Layers3 className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground/85">
                {selected ? selected.name : "New preset"}
              </div>
              <div className="text-xs text-muted-foreground">
                {selected ? "Edit preset" : "Configure a sandbox preset"}
              </div>
            </div>
            <button
              type="button"
              onClick={resetEditor}
              aria-label="Close editor"
              className={iconBtn}
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="grid gap-4 p-4">
            <label className={fieldLabel}>
              Name
              <input
                aria-label="Preset name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Node 22 workspace"
                className={cn(inputClass, "font-normal")}
              />
            </label>

            {selectedIsAuto ? (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-foreground/80">
                  Automatic cloudcode.yaml environments
                </div>
                <p className={fieldHint}>
                  When this preset runs against a repo, Cloudcode uses the
                  repo&apos;s cloudcode.yaml first. If the repo does not have
                  one, it uses the saved Convex cloudcode.yaml for the live
                  sandbox.
                </p>
                {selected?.environments?.length ? (
                  <div className="-mx-4 mt-3 border-y border-border/60">
                    {selected.environments.map((environment) => (
                      <div
                        key={environment.id}
                        className="flex items-center gap-2 border-b border-border/60 px-4 py-2 last:border-0"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
                          {environment.repoUrl.replace(/^https?:\/\//, "")}
                        </span>
                        <span className={metaPill}>{environment.status}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div
                  className={cn(
                    "flex items-start justify-between gap-3 px-3 py-2.5",
                    cardSurfaceClass
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground/80">
                      Auto environment
                    </div>
                    <p className={fieldHint}>
                      Use the repo&apos;s cloudcode.yaml for each live chat
                      sandbox, falling back to the saved Convex cloudcode.yaml
                      when the repo does not include one. The scripts and
                      secrets below run after the environment is ready.
                    </p>
                  </div>
                  <Switch
                    aria-label="Auto environment"
                    className="mt-0.5"
                    checked={autoEnvironment}
                    onCheckedChange={setAutoEnvironment}
                  />
                </div>

                {autoEnvironment && selected?.environments?.length ? (
                  <div className="-mx-4 border-y border-border/60">
                    {selected.environments.map((environment) => (
                      <div
                        key={environment.id}
                        className="flex items-center gap-2 border-b border-border/60 px-4 py-2 last:border-0"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
                          {environment.repoUrl.replace(/^https?:\/\//, "")}
                        </span>
                        <span className={metaPill}>{environment.status}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <label className={fieldLabel}>
                  PATH setup script
                  <textarea
                    aria-label="PATH setup script"
                    value={pathInstallScript}
                    onChange={(event) =>
                      setPathInstallScript(event.target.value)
                    }
                    placeholder={
                      "curl -fsSL https://vite.plus | bash\nnpm install -g vercel"
                    }
                    spellCheck={false}
                    className={cn(textareaClass, "min-h-24 font-normal")}
                  />
                  <span className={fieldHint}>
                    Runs from the sandbox home before repo setup. Use it for
                    CLIs and language tools that should be available on PATH.
                  </span>
                </label>

                <label className={fieldLabel}>
                  Repo install script
                  <textarea
                    aria-label="Repo install script"
                    value={installScript}
                    onChange={(event) => setInstallScript(event.target.value)}
                    placeholder={"pnpm install\npnpm test -- --runInBand"}
                    spellCheck={false}
                    className={cn(textareaClass, "min-h-28 font-normal")}
                  />
                  <span className={fieldHint}>
                    Runs from the cloned repo root before Codex starts. Leave
                    blank when the base environment already has everything.
                  </span>
                </label>

                <div className="border-t border-border/60 pt-4">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground/80">
                    <KeyRound className="size-3.5 text-muted-foreground" />
                    Secrets
                    {selected?.secrets.length ? (
                      <span className={metaPill}>
                        {selected.secrets.length}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setImportMode((value) => !value)
                        setError("")
                      }}
                      className={cn(navAction, "ml-auto h-7 px-2.5")}
                    >
                      <ClipboardPaste className="size-3.5" />
                      {importMode ? "Add manually" : "Paste .env"}
                    </button>
                  </div>

                  {selected?.secrets.length ? (
                    <div className="-mx-4 mb-3 border-y border-border/60">
                      {selected.secrets.map((secret) => (
                        <div
                          key={secret.id}
                          className="flex items-center gap-2 border-b border-border/60 px-4 py-2 last:border-0"
                        >
                          <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-xs text-foreground/85">
                            {secret.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteSecret(secret.id)}
                            disabled={saving}
                            aria-label={`Delete ${secret.name}`}
                            title={`Delete ${secret.name}`}
                            className={cn(iconBtn, "hover:text-destructive")}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : selected ? (
                    <p className="mb-3 text-xs text-muted-foreground">
                      No preset secrets.
                    </p>
                  ) : null}

                  {importMode ? (
                    <div className="grid gap-2">
                      <textarea
                        aria-label="Paste .env file"
                        value={importText}
                        onChange={(event) => setImportText(event.target.value)}
                        placeholder={
                          "# Paste the contents of your .env file\nSUPABASE_URL=https://xyz.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=ey..."
                        }
                        spellCheck={false}
                        className={cn(textareaClass, "min-h-32")}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className={fieldHint}>
                          {importVars.length > 0
                            ? `${importVars.length} variable${
                                importVars.length === 1 ? "" : "s"
                              } detected${
                                parsedImport.errors.length
                                  ? ` · ${parsedImport.errors.length} line${
                                      parsedImport.errors.length === 1
                                        ? ""
                                        : "s"
                                    } skipped`
                                  : ""
                              }`
                            : importText.trim()
                              ? "No valid variables found."
                              : "Paste KEY=value lines from a .env file."}
                        </span>
                        <button
                          type="button"
                          onClick={importSecrets}
                          disabled={saving || importVars.length === 0}
                          className={cn(
                            navPrimary,
                            "h-9 shrink-0 justify-center px-4"
                          )}
                        >
                          {saving
                            ? "Importing"
                            : importVars.length > 0
                              ? `Import ${importVars.length}`
                              : "Import"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <input
                        aria-label="Secret name"
                        value={secretName}
                        onChange={(event) => setSecretName(event.target.value)}
                        placeholder="SUPABASE_SERVICE_ROLE_KEY"
                        className={cn(
                          inputClass,
                          "font-[family-name:var(--font-mono)] text-xs"
                        )}
                        spellCheck={false}
                      />
                      <input
                        aria-label="Secret value"
                        value={secretValue}
                        onChange={(event) => setSecretValue(event.target.value)}
                        placeholder="Value"
                        type="password"
                        className={cn(inputClass, "text-xs")}
                      />
                      <button
                        type="button"
                        onClick={saveSecret}
                        disabled={saving || !secretName || !secretValue}
                        className={cn(navPrimary, "h-9 justify-center px-4")}
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3.5 py-2.5">
            {!selectedIsAuto ? (
              <button
                type="button"
                onClick={deletePreset}
                disabled={!selected || saving}
                className={navDestructive}
              >
                <Trash2 className="size-3.5" />
                Delete
              </button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={resetEditor}
                disabled={saving}
                className={navAction}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={savePreset}
                disabled={saving || !name.trim()}
                className={navPrimary}
              >
                {saving ? "Saving" : selected ? "Save preset" : "Create preset"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
