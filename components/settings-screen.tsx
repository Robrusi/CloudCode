"use client"

import { useMutation, useQuery } from "convex/react"
import {
  ChevronRight,
  ClipboardPaste,
  CornerDownRight,
  KeyRound,
  Layers3,
  Plus,
  Terminal,
  Trash2,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"

import { Switch } from "@/components/ui/switch"
import { cardSurfaceClass } from "@/components/ui/surface"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
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

type AuthStatus = {
  exists: boolean
}

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

export function SettingsScreen({
  authStatus,
  authError,
  githubStatus,
  githubAuthError,
  onGitHubAuthChanged,
  sandboxPresets,
}: {
  authStatus: AuthStatus | null
  authError: string
  githubStatus: GitHubAuthStatus | null
  githubAuthError: string
  onGitHubAuthChanged: () => void | Promise<void>
  sandboxPresets: SandboxPresetRecord[]
}) {
  const detailedPresets = useQuery(api.sandboxPresets.listWithEnvironments)
  const presets = (detailedPresets ?? sandboxPresets) as SandboxPresetRecord[]
  const connected = Boolean(authStatus?.exists)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-2xl px-4 pt-10 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-6">
          <h1 className="text-2xl font-medium tracking-tight text-foreground/90">
            Settings
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Manage connected accounts, Daytona presets, and preset secrets.
          </p>

          <section className="mt-8 space-y-2">
            <h2 className={cn(sectionLabel, "px-1")}>Connections</h2>
            <div className={card}>
              <ChatGPTConnectionRow
                connected={connected}
                authError={authError}
              />
              <GitHubConnectionRow
                status={githubStatus}
                error={githubAuthError}
                onGitHubAuthChanged={onGitHubAuthChanged}
              />
            </div>
          </section>

          <PresetSettings presets={presets} />
        </div>
      </div>
    </div>
  )
}

function ChatGPTConnectionRow({
  connected,
  authError,
}: {
  connected: boolean
  authError: string
}) {
  return (
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
        <div className="text-xs text-muted-foreground">
          {connected
            ? "Connected. Codex runs are authorized with your ChatGPT account."
            : "Sign in with your ChatGPT account to authorize Codex runs."}
        </div>
        {authError ? (
          <div className="mt-1 text-[11px] leading-4 text-destructive">
            {authError}
          </div>
        ) : null}
      </div>
      <form action="/api/codex-auth/login" method="get">
        <button type="submit" className={connected ? navAction : navPrimary}>
          {connected ? "Reconnect" : "Connect"}
        </button>
      </form>
    </div>
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
                  When this preset runs against a repo, Cloudcode scans the
                  repo, writes cloudcode.yaml, executes its setup commands in a
                  builder sandbox once, then reuses that sandbox for later
                  chats.
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
                      Scan the repo&apos;s cloudcode.yaml and build the
                      environment once in a builder sandbox, then reuse it. The
                      scripts and secrets below run after the environment is
                      ready.
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
