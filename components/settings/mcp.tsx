"use client"

import { useMutation } from "convex/react"
import {
  ChevronRight,
  Globe,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Wrench,
  X,
} from "lucide-react"
import { useState } from "react"

import {
  McpIntegrationsGrid,
  mcpProviderIcon,
} from "@/components/settings/mcp-connections"
import { McpServerForm } from "@/components/settings/mcp-form"
import { mcpServerSubtitle } from "@/components/settings/mcp-model"
import { fieldHint, metaPill, SettingsPage } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Switch } from "@/components/ui/switch"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { requestJson } from "@/lib/http/client-json"
import type { McpServerRecord } from "@/lib/mcp/server-types"
import { cn } from "@/lib/shared/utils"

export function McpSettings({
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
  const setServerEnabled = useMutation(api.mcpServers.setEnabled)
  const [selectedId, setSelectedId] = useState<Id<"mcpServers"> | null>(null)
  const [creatingCustom, setCreatingCustom] = useState(false)
  const [toggleError, setToggleError] = useState("")
  const selected = servers.find((server) => server.id === selectedId) ?? null

  function openCreate() {
    setSelectedId(null)
    setCreatingCustom(true)
  }

  async function deleteServer(serverId: Id<"mcpServers">) {
    // OAuth-managed servers disconnect through the OAuth route so the
    // provider tokens are revoked, not just deleted locally.
    const oauthProvider = servers.find(
      (server) => server.id === serverId
    )?.oauthProvider
    if (oauthProvider) {
      await requestJson(
        "/api/mcp/oauth/connections",
        "DELETE",
        { provider: oauthProvider },
        { fallbackError: "Unable to disconnect the MCP integration." }
      )
    } else {
      await requestJson(
        "/api/mcp/custom",
        "DELETE",
        { serverId },
        {
          fallbackError: "Unable to remove MCP server.",
        }
      )
    }
    setSelectedId(null)
    await onReload()
  }

  async function toggleEnabled(serverId: Id<"mcpServers">, enabled: boolean) {
    setToggleError("")
    try {
      await setServerEnabled({ enabled, serverId })
      await onReload()
    } catch (err) {
      setToggleError(
        err instanceof Error ? err.message : "Unable to update MCP server."
      )
    }
  }

  return (
    <SettingsPage
      title="MCP Connections"
      description="Connect integrations in one click, or give Codex extra tools over STDIO or streamable HTTP."
      action={
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" />
          Custom MCP
        </Button>
      }
    >
      {creatingCustom ? (
        <div className="rounded-2xl border border-border/60 bg-muted/40 p-4 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                Connect a custom MCP
              </div>
              <div className="text-xs text-muted-foreground">
                Run over STDIO or streamable HTTP
              </div>
            </div>
            <IconButton
              size="sm"
              onClick={() => setCreatingCustom(false)}
              aria-label="Close custom MCP editor"
            >
              <X className="size-3.5" />
            </IconButton>
          </div>

          <McpServerForm
            onCancel={() => setCreatingCustom(false)}
            onSaved={async (serverId) => {
              setCreatingCustom(false)
              setSelectedId(serverId)
              await onReload()
            }}
          />
        </div>
      ) : null}

      <McpIntegrationsGrid />

      <div className="space-y-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Loading MCP connections…
            </div>
          </div>
        ) : loadError ? (
          <div className="flex items-center gap-3 py-3">
            <Server className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                Unable to load MCP connections
              </div>
              <div className="line-clamp-2 text-xs text-muted-foreground">
                {loadError}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onReload()}
              className="gap-1.5"
            >
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : servers.length ? (
          <>
            <div className="mb-2.5 text-xs font-medium text-muted-foreground">
              Connected servers
            </div>
            {servers.map((server) => {
              const active = selected?.id === server.id
              const RowIcon =
                mcpProviderIcon(server.oauthProvider) ??
                (server.transport === "http" ? Globe : Terminal)
              const subtitle = mcpServerSubtitle(server)
              return (
                <div
                  key={server.id}
                  className={cn(
                    "overflow-hidden rounded-xl border border-border/60 transition-colors",
                    active && "bg-muted/40"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingCustom(false)
                      setSelectedId(active ? null : server.id)
                    }}
                    aria-expanded={active}
                    className={cn(
                      "group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                      active ? "" : "hover:bg-muted"
                    )}
                  >
                    <RowIcon
                      className={cn(
                        "size-5 shrink-0 text-muted-foreground",
                        !server.enabled && "opacity-50"
                      )}
                    />
                    <div
                      className={cn(
                        "min-w-0 flex-1",
                        !server.enabled && "opacity-50"
                      )}
                    >
                      <div className="truncate text-sm font-medium text-foreground/90">
                        {server.name}
                      </div>
                      <div className="truncate font-[family-name:var(--font-mono)] text-xs text-muted-foreground">
                        {subtitle}
                      </div>
                    </div>
                    {!server.enabled ? (
                      <span className={metaPill}>Off</span>
                    ) : null}
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
                    {server.oauthProvider ? (
                      <span
                        className={metaPill}
                        title="Managed by an OAuth connection in Settings → Connections"
                      >
                        OAuth
                      </span>
                    ) : null}
                    {server.managedIntegrationProvider ? (
                      <span
                        className={metaPill}
                        title="Managed by the Slack or Linear connection"
                      >
                        Connection
                      </span>
                    ) : null}
                    <span className={metaPill}>
                      {server.transport === "http" ? "HTTP" : "STDIO"}
                    </span>
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0 transition-transform",
                        active
                          ? "rotate-90 text-muted-foreground"
                          : "text-muted-foreground/50 group-hover:text-muted-foreground"
                      )}
                    />
                  </button>

                  {active ? (
                    <div className="border-t border-border/60 px-3 pt-3 pb-3">
                      {server.managedIntegrationProvider ? (
                        <div className="mb-4">
                          <div className="text-sm font-medium text-foreground">
                            Managed by Connections
                          </div>
                          <p className={fieldHint}>
                            Authorization, availability, and disconnects are
                            controlled by the {server.name} connection. Tools
                            discovered from the official MCP server default to
                            approval required.
                          </p>
                        </div>
                      ) : (
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground">
                              Available to Codex
                            </div>
                            <p className={fieldHint}>
                              When off, this server is excluded from new Codex
                              runs.
                            </p>
                          </div>
                          <Switch
                            aria-label="Available to Codex"
                            checked={server.enabled}
                            onCheckedChange={(enabled) =>
                              void toggleEnabled(server.id, enabled)
                            }
                          />
                        </div>
                      )}

                      {toggleError ? (
                        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                          {toggleError}
                        </div>
                      ) : null}

                      {server.managedIntegrationProvider ? (
                        server.tools.length ? (
                          <div className="space-y-1.5">
                            {server.tools.map((tool) => (
                              <div
                                key={tool.id}
                                className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2"
                              >
                                <span className="truncate font-[family-name:var(--font-mono)] text-xs text-foreground/80">
                                  {tool.name}
                                </span>
                                <span className={metaPill}>{tool.policy}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className={fieldHint}>
                            Tools will appear after the first successful run.
                          </p>
                        )
                      ) : (
                        <McpServerForm
                          key={server.id}
                          server={server}
                          onCancel={() => setSelectedId(null)}
                          onRemove={() => deleteServer(server.id)}
                          onSaved={async () => {
                            setSelectedId(null)
                            await onReload()
                          }}
                        />
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <Server className="size-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">
                No MCP servers connected
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect an integration above in one click, or add a custom MCP
                server over STDIO or HTTP.
              </p>
            </div>
            <Button size="sm" onClick={openCreate} className="gap-1.5">
              <Plus className="size-4" />
              Custom MCP
            </Button>
          </div>
        )}
      </div>
    </SettingsPage>
  )
}
