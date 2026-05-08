"use client"

import { useMutation } from "convex/react"
import {
  ChevronRight,
  KeyRound,
  Layers3,
  PanelLeft,
  Plus,
  Terminal,
  Trash2,
  X,
} from "lucide-react"
import { useState } from "react"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"

type AuthStatus = {
  exists: boolean
}

type SandboxPresetSecretRecord = {
  id: Id<"sandboxPresetSecrets">
  name: string
}

type SandboxPresetRecord = {
  createdAt: number
  daytonaSnapshot?: string
  id: Id<"sandboxPresets">
  installScript?: string
  name: string
  pathInstallScript?: string
  secrets: SandboxPresetSecretRecord[]
  updatedAt: number
}

export function SettingsScreen({
  authStatus,
  authError,
  sandboxPresets,
  sidebarOpen,
  onToggleSidebar,
}: {
  authStatus: AuthStatus | null
  authError: string
  sandboxPresets: SandboxPresetRecord[]
  sidebarOpen: boolean
  onToggleSidebar: () => void
}) {
  const connected = Boolean(authStatus?.exists)
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 pr-4 pl-2 backdrop-blur-xl">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelLeft className="size-3.5" />
        </button>
        <span className="min-w-0 truncate text-sm font-medium text-foreground/85">
          Settings
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-full max-w-2xl px-6 pt-10 pb-20">
          <h1 className="text-2xl font-medium tracking-tight text-foreground/90">
            Settings
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Manage connected accounts, Daytona presets, and preset secrets.
          </p>

          <div className="mt-8">
            <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Connections
            </h2>
            <div className="mt-2 overflow-hidden rounded-xl border border-border/60 bg-background">
              <div className="flex items-center gap-3 px-3.5 py-3">
                <svg
                  viewBox="0 0 256 260"
                  preserveAspectRatio="xMidYMid"
                  aria-hidden
                  className="size-6 shrink-0 fill-current text-foreground/80"
                >
                  <path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground/85">
                    ChatGPT
                  </div>
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
                <a
                  href="/api/codex-auth/login"
                  className={cn(
                    "inline-flex h-7 shrink-0 items-center justify-center rounded-md px-3 text-xs font-medium transition-colors",
                    connected
                      ? "border border-border/60 text-foreground/80 hover:bg-muted"
                      : "bg-foreground text-background hover:opacity-85"
                  )}
                >
                  {connected ? "Reconnect" : "Connect"}
                </a>
              </div>
            </div>
          </div>

          <PresetSettings presets={sandboxPresets} />
        </div>
      </div>
    </div>
  )
}

function PresetSettings({ presets }: { presets: SandboxPresetRecord[] }) {
  const createPreset = useMutation(api.sandboxPresets.create)
  const updatePreset = useMutation(api.sandboxPresets.update)
  const removePreset = useMutation(api.sandboxPresets.remove)
  const removeSecret = useMutation(api.sandboxPresets.removeSecret)
  const [selectedId, setSelectedId] = useState<Id<"sandboxPresets"> | null>(
    null
  )
  const selected = presets.find((preset) => preset.id === selectedId) ?? null
  const [name, setName] = useState("")
  const [pathInstallScript, setPathInstallScript] = useState("")
  const [installScript, setInstallScript] = useState("")
  const [secretName, setSecretName] = useState("")
  const [secretValue, setSecretValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)

  function resetEditor() {
    setSelectedId(null)
    setCreating(false)
    setName("")
    setPathInstallScript("")
    setInstallScript("")
    setSecretName("")
    setSecretValue("")
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
    setPathInstallScript(preset.pathInstallScript ?? "")
    setInstallScript(preset.installScript ?? "")
    setSecretName("")
    setSecretValue("")
    setError("")
  }

  async function savePreset() {
    setSaving(true)
    setError("")
    try {
      if (selected) {
        await updatePreset({
          installScript: installScript.trim() || undefined,
          name,
          pathInstallScript: pathInstallScript.trim() || undefined,
          presetId: selected.id,
        })
      } else {
        const id = await createPreset({
          installScript: installScript.trim() || undefined,
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

  async function saveSecret() {
    setSaving(true)
    setError("")
    try {
      let presetId = selected?.id
      if (!presetId) {
        if (!name.trim()) {
          setError("Name the preset before adding secrets.")
          return
        }
        presetId = await createPreset({
          installScript: installScript.trim() || undefined,
          name,
          pathInstallScript: pathInstallScript.trim() || undefined,
        })
        setSelectedId(presetId)
        setCreating(false)
      }
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

  async function deleteSecret(secretId: Id<"sandboxPresetSecrets">) {
    setSaving(true)
    setError("")
    try {
      await removeSecret({ secretId })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete secret.")
    } finally {
      setSaving(false)
    }
  }

  const isEditing = selected !== null || creating

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Daytona Presets
        </h2>
        <button
          type="button"
          onClick={startNewPreset}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted"
        >
          <Plus className="size-3.5" />
          New preset
        </button>
      </div>

      <div className="mt-2 overflow-hidden rounded-xl border border-border/60 bg-background">
        {presets.length === 0 ? (
          <div className="px-3.5 py-8 text-center text-xs leading-5 text-muted-foreground">
            No presets yet. Create one to set up tools, installs, and secrets.
          </div>
        ) : (
          presets.map((preset) => {
            const active = selected?.id === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPreset(preset)}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-border/50 px-3.5 py-3 text-left transition-colors last:border-0 hover:bg-muted/70",
                  active && "bg-muted"
                )}
              >
                <Layers3 className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground/85">
                    {preset.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[
                      preset.pathInstallScript ? "PATH tools" : "",
                      preset.installScript ? "repo install" : "",
                      preset.secrets.length
                        ? `${preset.secrets.length} secret${preset.secrets.length === 1 ? "" : "s"}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Cloudcode default environment"}
                  </div>
                </div>
                {preset.pathInstallScript ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    title="Runs a PATH setup script from the sandbox home"
                  >
                    <Terminal className="size-2.5" />
                    PATH
                  </span>
                ) : null}
                {preset.secrets.length ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    title={`${preset.secrets.length} secret${preset.secrets.length === 1 ? "" : "s"}`}
                  >
                    <KeyRound className="size-2.5" />
                    {preset.secrets.length}
                  </span>
                ) : null}
                {preset.installScript ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    title="Runs an install script from the repo root"
                  >
                    <Terminal className="size-2.5" />
                    script
                  </span>
                ) : null}
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground/60",
                    active && "text-foreground/70"
                  )}
                />
              </button>
            )
          })
        )}
      </div>

      {isEditing ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-border/60 bg-background">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3.5 py-2.5">
            <div className="min-w-0 truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {selected ? "Edit preset" : "New preset"}
            </div>
            <button
              type="button"
              onClick={resetEditor}
              aria-label="Close editor"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="grid gap-4 p-4">
            <label className="grid gap-1.5 text-xs font-medium text-foreground/80">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Node 22 workspace"
                className="h-9 rounded-md border border-border/70 bg-transparent px-3 text-sm font-normal transition-colors outline-none focus:border-foreground/30"
              />
            </label>

            <label className="grid gap-1.5 text-xs font-medium text-foreground/80">
              PATH setup script
              <textarea
                value={pathInstallScript}
                onChange={(event) => setPathInstallScript(event.target.value)}
                placeholder={
                  "curl -fsSL https://vite.plus | bash\nnpm install -g vercel"
                }
                spellCheck={false}
                className="min-h-24 resize-y rounded-md border border-border/70 bg-transparent px-3 py-2 font-mono text-xs font-normal leading-5 transition-colors outline-none focus:border-foreground/30"
              />
              <span className="text-[11px] leading-4 font-normal text-muted-foreground">
                Runs from the sandbox home before repo setup. Use it for CLIs
                and language tools that should be available on PATH.
              </span>
            </label>

            <label className="grid gap-1.5 text-xs font-medium text-foreground/80">
              Repo install script
              <textarea
                value={installScript}
                onChange={(event) => setInstallScript(event.target.value)}
                placeholder={"pnpm install\npnpm test -- --runInBand"}
                spellCheck={false}
                className="min-h-28 resize-y rounded-md border border-border/70 bg-transparent px-3 py-2 font-mono text-xs font-normal leading-5 transition-colors outline-none focus:border-foreground/30"
              />
              <span className="text-[11px] leading-4 font-normal text-muted-foreground">
                Runs from the cloned repo root before Codex starts. Leave blank
                when the base environment already has everything.
              </span>
            </label>

            <div className="border-t border-border/60 pt-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground/80">
                <KeyRound className="size-3.5 text-muted-foreground" />
                Secrets
                {selected?.secrets.length ? (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                    {selected.secrets.length}
                  </span>
                ) : null}
              </div>

              {selected?.secrets.length ? (
                <div className="mb-3 overflow-hidden rounded-md border border-border/60">
                  {selected.secrets.map((secret) => (
                    <div
                      key={secret.id}
                      className="flex items-center gap-2 border-b border-border/50 px-2.5 py-2 last:border-0"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80">
                        {secret.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        saved
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteSecret(secret.id)}
                        disabled={saving}
                        aria-label={`Delete ${secret.name}`}
                        title={`Delete ${secret.name}`}
                        className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : selected ? (
                <div className="mb-3 rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                  No preset secrets.
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  value={secretName}
                  onChange={(event) => setSecretName(event.target.value)}
                  placeholder="SUPABASE_SERVICE_ROLE_KEY"
                  className="h-9 rounded-md border border-border/70 bg-transparent px-3 font-mono text-xs transition-colors outline-none focus:border-foreground/30"
                  spellCheck={false}
                />
                <input
                  value={secretValue}
                  onChange={(event) => setSecretValue(event.target.value)}
                  placeholder="Value"
                  type="password"
                  className="h-9 rounded-md border border-border/70 bg-transparent px-3 text-xs transition-colors outline-none focus:border-foreground/30"
                />
                <button
                  type="button"
                  onClick={saveSecret}
                  disabled={saving || !secretName || !secretValue}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>

            {error ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3.5 py-2.5">
            <button
              type="button"
              onClick={deletePreset}
              disabled={!selected || saving}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-40"
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
            <button
              type="button"
              onClick={savePreset}
              disabled={saving || !name.trim()}
              className="inline-flex h-7 items-center justify-center rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-40"
            >
              {saving ? "Saving" : selected ? "Save preset" : "Create preset"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
