"use client"

import { useCallback, useEffect, useState } from "react"

import {
  fieldHint,
  statusBadge,
  statusIdle,
  statusOk,
} from "@/components/settings/shared"
import { LinearIcon, SlackIcon } from "@/components/ui/brand-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fetchJson, postJson } from "@/lib/http/client-json"
import { cn } from "@/lib/shared/utils"

type Installation = {
  defaultRepoUrl?: string
  enabled: boolean
  externalName?: string
  id: string
  provider: "slack" | "linear"
}

type IntegrationsStatus = {
  installations: Installation[]
  linearConfigured: boolean
  slackConfigured: boolean
  slackMode: "oauth" | "token" | null
  stateConfigured: boolean
}

function DefaultRepoField({
  installation,
  onSaved,
}: {
  installation: Installation
  onSaved: () => void | Promise<void>
}) {
  const [value, setValue] = useState(installation.defaultRepoUrl ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const dirty = value.trim() !== (installation.defaultRepoUrl ?? "")

  async function save() {
    if (!dirty || saving) return
    setSaving(true)
    setError("")
    try {
      await fetchJson(
        "/api/integrations",
        {
          body: JSON.stringify({
            defaultRepoUrl: value.trim(),
            installationId: installation.id,
          }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        },
        { fallbackError: "Unable to save the default repository." }
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
    <div className="mt-2.5 flex items-start gap-2 pl-8">
      <div className="min-w-0 flex-1">
        <Input
          aria-label="Default repository"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="https://github.com/owner/repo.git"
          spellCheck={false}
          autoComplete="off"
        />
        <p className={fieldHint}>
          Sessions started from mentions run against this repository unless the
          message includes !repo=owner/name.
        </p>
        {error ? (
          <p className="mt-1 text-[11px] leading-4 text-destructive">{error}</p>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!dirty || saving}
        onClick={() => void save()}
      >
        {saving ? "Saving" : "Save"}
      </Button>
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
      <div className="flex items-center gap-3">
        {icon}
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
        <DefaultRepoField installation={installation} onSaved={onChanged} />
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
    <div className="space-y-6">
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
