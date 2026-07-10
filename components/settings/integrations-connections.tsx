"use client"

import { useQuery } from "convex/react"
import { useCallback, useEffect, useState } from "react"

import { MenuSelect } from "@/components/automations/menu-select"
import {
  fieldHint,
  fieldLabel,
  statusBadge,
  statusIdle,
  statusOk,
} from "@/components/settings/shared"
import { LinearIcon, SlackIcon } from "@/components/ui/brand-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/convex/_generated/api"
import {
  MODEL_LABEL,
  MODELS,
  THINKING_LABEL,
  THINKINGS,
} from "@/lib/chat/options"
import { fetchJson, postJson } from "@/lib/http/client-json"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"
import { cn } from "@/lib/shared/utils"

type Installation = {
  defaultBaseBranch?: string
  defaultModel?: string
  defaultReasoningEffort?: string
  defaultRepoUrl?: string
  defaultSandboxPresetId?: string
  enabled: boolean
  externalName?: string
  id: string
  provider: "slack" | "linear"
}

// The hardcoded session defaults; showing them as the selected value means
// "default" needs no separate clear state.
const SESSION_MODEL_DEFAULT = "gpt-5.5"
const SESSION_EFFORT_DEFAULT = "medium"

type IntegrationsStatus = {
  installations: Installation[]
  linearConfigured: boolean
  slackConfigured: boolean
  slackMode: "oauth" | "token" | null
  stateConfigured: boolean
}

type InstallationDraft = {
  defaultBaseBranch: string
  defaultModel: string
  defaultReasoningEffort: string
  defaultRepoUrl: string
  defaultSandboxPresetId: string
}

function draftOf(installation: Installation): InstallationDraft {
  return {
    defaultBaseBranch: installation.defaultBaseBranch ?? "",
    defaultModel: installation.defaultModel ?? SESSION_MODEL_DEFAULT,
    defaultReasoningEffort:
      installation.defaultReasoningEffort ?? SESSION_EFFORT_DEFAULT,
    defaultRepoUrl: installation.defaultRepoUrl ?? "",
    defaultSandboxPresetId: installation.defaultSandboxPresetId ?? "",
  }
}

/** Per-workspace session defaults: which repo, environment, and model a
 * session started from this integration uses. Inline !repo/!preset commands
 * in the triggering message override these per session. */
function InstallationSettings({
  installation,
  onSaved,
}: {
  installation: Installation
  onSaved: () => void | Promise<void>
}) {
  const rawPresets = useQuery(api.sandboxPresets.list)
  // The built-in auto preset is already the "" option below.
  const presets = ((rawPresets ?? []) as SandboxPresetRecord[]).filter(
    (preset) => !preset.isBuiltInAutoEnvironment
  )
  const [draft, setDraft] = useState<InstallationDraft>(() =>
    draftOf(installation)
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const saved = draftOf(installation)

  // Resync when the server-side values change (a save can come back
  // canonicalized, e.g. the repo URL gaining ".git"); unrelated refreshes
  // leave in-progress edits alone.
  const savedKey = JSON.stringify(saved)
  const [syncedKey, setSyncedKey] = useState(savedKey)
  if (syncedKey !== savedKey) {
    setSyncedKey(savedKey)
    setDraft(draftOf(installation))
  }

  const dirty =
    draft.defaultBaseBranch.trim() !== saved.defaultBaseBranch ||
    draft.defaultModel !== saved.defaultModel ||
    draft.defaultReasoningEffort !== saved.defaultReasoningEffort ||
    draft.defaultRepoUrl.trim() !== saved.defaultRepoUrl ||
    draft.defaultSandboxPresetId !== saved.defaultSandboxPresetId

  const set = <K extends keyof InstallationDraft>(key: K, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }))

  async function save() {
    if (!dirty || saving) return
    setSaving(true)
    setError("")
    try {
      await fetchJson(
        "/api/integrations",
        {
          body: JSON.stringify({
            defaultBaseBranch: draft.defaultBaseBranch.trim(),
            defaultModel: draft.defaultModel,
            defaultReasoningEffort: draft.defaultReasoningEffort,
            defaultRepoUrl: draft.defaultRepoUrl.trim(),
            defaultSandboxPresetId: draft.defaultSandboxPresetId,
            installationId: installation.id,
          }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        },
        { fallbackError: "Unable to save the integration settings." }
      )
      await onSaved()
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 pl-8">
      <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2">
        <div className={cn(fieldLabel, "sm:col-span-2")}>
          Repository
          <Input
            aria-label="Default repository"
            value={draft.defaultRepoUrl}
            onChange={(event) => set("defaultRepoUrl", event.target.value)}
            placeholder="https://github.com/owner/repo.git"
            spellCheck={false}
            autoComplete="off"
            className="font-normal"
          />
        </div>
        <div className={fieldLabel}>
          Base branch
          <Input
            aria-label="Default base branch"
            value={draft.defaultBaseBranch}
            onChange={(event) => set("defaultBaseBranch", event.target.value)}
            placeholder="Repository default"
            spellCheck={false}
            autoComplete="off"
            className="font-normal"
          />
        </div>
        <div className={fieldLabel}>
          Environment setup
          <MenuSelect
            ariaLabel="Default sandbox preset"
            value={draft.defaultSandboxPresetId}
            triggerClassName="h-9 px-3 font-normal"
            options={[
              { label: "Auto environment", value: "" },
              ...presets.map((preset) => ({
                label: preset.name,
                value: preset.id,
              })),
            ]}
            onChange={(value) => set("defaultSandboxPresetId", value)}
          />
        </div>
        <div className={fieldLabel}>
          Model
          <MenuSelect
            ariaLabel="Default model"
            value={draft.defaultModel}
            triggerClassName="h-9 px-3 font-normal"
            options={MODELS.map((value) => ({
              label:
                value === SESSION_MODEL_DEFAULT
                  ? `${MODEL_LABEL[value]} (default)`
                  : MODEL_LABEL[value],
              value,
            }))}
            onChange={(value) => set("defaultModel", value)}
          />
        </div>
        <div className={fieldLabel}>
          Reasoning effort
          <MenuSelect
            ariaLabel="Default reasoning effort"
            value={draft.defaultReasoningEffort}
            triggerClassName="h-9 px-3 font-normal"
            options={THINKINGS.map((value) => ({
              label:
                value === SESSION_EFFORT_DEFAULT
                  ? `${THINKING_LABEL[value]} (default)`
                  : THINKING_LABEL[value],
              value,
            }))}
            onChange={(value) => set("defaultReasoningEffort", value)}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <p className={cn(fieldHint, "min-w-0")}>
          New sessions use these defaults; !repo and !preset in a message
          override them.
        </p>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving" : "Save"}
        </Button>
      </div>
      {error ? (
        <p className="mt-2 text-[11px] leading-4 text-destructive">{error}</p>
      ) : null}
    </div>
  )
}

function IntegrationRow({
  configured,
  configureHint,
  connectAction,
  description,
  icon,
  installation,
  name,
  onChanged,
}: {
  configured: boolean
  configureHint: string
  connectAction: () => void | Promise<void>
  description: string
  icon: React.ReactNode
  installation: Installation | undefined
  name: string
  onChanged: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function run(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      await action()
      await onChanged()
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Action failed."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="mt-px shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-foreground">{name}</span>
            <span
              className={cn(
                statusBadge,
                installation?.enabled ? statusOk : statusIdle
              )}
            >
              {installation
                ? installation.enabled
                  ? `Connected${installation.externalName ? ` · ${installation.externalName}` : ""}`
                  : "Paused"
                : configured
                  ? "Not connected"
                  : "Needs server setup"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!installation && configured ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void run(async () => await connectAction())}
            >
              Connect {name}
            </Button>
          ) : null}
          {installation ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                className="text-muted-foreground"
                onClick={() =>
                  void run(() =>
                    fetchJson(
                      "/api/integrations",
                      {
                        body: JSON.stringify({
                          enabled: !installation.enabled,
                          installationId: installation.id,
                        }),
                        headers: { "Content-Type": "application/json" },
                        method: "PATCH",
                      },
                      { fallbackError: `Unable to update ${name}.` }
                    )
                  )
                }
              >
                {installation.enabled ? "Pause" : "Resume"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Disconnect ${name}? Automations triggered by it will be disabled.`
                    )
                  ) {
                    return
                  }
                  void run(() =>
                    fetchJson(
                      "/api/integrations",
                      {
                        body: JSON.stringify({
                          installationId: installation.id,
                        }),
                        headers: { "Content-Type": "application/json" },
                        method: "DELETE",
                      },
                      { fallbackError: `Unable to disconnect ${name}.` }
                    )
                  )
                }}
              >
                Disconnect
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {!configured ? (
        <p className={cn(fieldHint, "pl-8")}>{configureHint}</p>
      ) : null}
      {installation ? (
        <InstallationSettings installation={installation} onSaved={onChanged} />
      ) : null}
      {error ? (
        <p className="mt-2 pl-8 text-[11px] leading-4 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Slack and Linear chat integrations: sessions from mentions and agent
 * sessions, plus event triggers for automations. Distinct from MCP servers —
 * these are inbound entry points, not agent tools. */
export function IntegrationsConnections() {
  const [status, setStatus] = useState<IntegrationsStatus | null>(null)
  const [loadError, setLoadError] = useState("")

  const refresh = useCallback(async () => {
    try {
      const data = await fetchJson<IntegrationsStatus>(
        "/api/integrations",
        { method: "GET" },
        { fallbackError: "Unable to load integrations." }
      )
      setStatus(data)
      setLoadError("")
    } catch (error) {
      // Keep any previously loaded status; a transient failure must not
      // masquerade as "needs server setup".
      setLoadError(
        error instanceof Error ? error.message : "Unable to load integrations."
      )
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const installations = status?.installations ?? []
  const slackInstallation = installations.find(
    (installation) => installation.provider === "slack"
  )
  const linearInstallation = installations.find(
    (installation) => installation.provider === "linear"
  )

  if (loadError && !status) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">
          Slack &amp; Linear status could not be loaded: {loadError}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => void refresh()}
        >
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-9">
      <IntegrationRow
        name="Slack"
        icon={<SlackIcon className="size-5 shrink-0" />}
        description="Mention @cloudcode in a channel to start a session; replies land in the thread."
        configured={Boolean(status?.slackConfigured && status.stateConfigured)}
        configureHint="Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET, and INTEGRATIONS_REDIS_URL on the server, then reload."
        installation={slackInstallation}
        connectAction={async () => {
          // OAuth mode installs through the browser; token mode verifies the
          // env bot token server-side.
          if (status?.slackMode === "oauth") {
            window.location.href = "/api/slack/oauth/start"
            return
          }
          await postJson(
            "/api/integrations/slack/connect",
            {},
            {},
            { fallbackError: "Unable to connect Slack." }
          )
        }}
        onChanged={refresh}
      />
      <IntegrationRow
        name="Linear"
        icon={<LinearIcon className="size-5 shrink-0" />}
        description="Delegate issues or mention the agent to start sessions with activity updates."
        configured={Boolean(status?.linearConfigured && status.stateConfigured)}
        configureHint="Set LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET, LINEAR_WEBHOOK_SECRET, and INTEGRATIONS_REDIS_URL on the server, then reload."
        installation={linearInstallation}
        connectAction={() => {
          window.location.href = "/api/linear/oauth/start"
        }}
        onChanged={refresh}
      />
    </div>
  )
}
