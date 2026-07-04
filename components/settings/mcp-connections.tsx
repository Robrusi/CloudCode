"use client"

import { useQuery } from "convex/react"
import {
  ArrowUpRight,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  X,
} from "lucide-react"
import NextImage from "next/image"
import { useEffect, useState, type ComponentType } from "react"

import { fieldHint, iconBtn, navPrimary } from "@/components/settings/shared"
import { cardSurfaceClass, popoverSurfaceClass } from "@/components/ui/surface"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { fetchJson, requestJson } from "@/lib/http/client-json"
import {
  MCP_OAUTH_PROVIDERS,
  type McpOauthProvider,
  type McpOauthProviderId,
} from "@/lib/mcp/oauth-providers"
import type { McpServerRecord } from "@/lib/mcp/server-types"
import { cn } from "@/lib/shared/utils"

type McpProviderIconProps = { className?: string }
type McpPresetProviderId = "x"
type McpProviderIconId = McpOauthProviderId | McpPresetProviderId
type SvglRoute = string | { dark: string; light: string }

export const X_API_MCP_SERVER_NAME = "xapi"
export const X_DOCS_MCP_SERVER_NAME = "x-docs"

const X_API_MCP_PRESET = {
  args: ["-y", "@xdevplatform/xurl", "mcp", "https://api.x.com/mcp"],
  consoleUrl: "https://developer.x.com",
  description:
    "Call X API tools for posts, users, bookmarks, trends, news, and Articles.",
  id: "x" as const,
  name: "X API",
  redirectUrl: "http://localhost:8080/callback",
  serverName: X_API_MCP_SERVER_NAME,
  setupHint:
    "Create or open an app, enable OAuth 2.0, add the redirect URL below, and copy the OAuth client ID and secret from the app settings.",
  tagline: "Posts & users",
}

const X_DOCS_MCP_PRESET = {
  description: "Search and read X API documentation pages.",
  name: "X Docs",
  serverName: X_DOCS_MCP_SERVER_NAME,
  tagline: "API docs",
  url: "https://docs.x.com/mcp",
}

const MCP_PROVIDER_ICON_ROUTES = {
  airtable: "/icons/mcp/airtable.svg",
  apollo_io: "https://svgl.app/library/apollo-io.svg",
  asana: "https://svgl.app/library/asana-logo.svg",
  atlassian: "https://svgl.app/library/atlassian.svg",
  attio: "/icons/mcp/attio.svg",
  cloudflare: "https://svgl.app/library/cloudflare.svg",
  datadog: "https://svgl.app/library/datadog.svg",
  gmail: "https://svgl.app/library/gmail.svg",
  granola: {
    dark: "https://svgl.app/library/granola-dark.svg",
    light: "https://svgl.app/library/granola-light.svg",
  },
  hubspot: "/icons/mcp/hubspot.svg",
  linear: "https://svgl.app/library/linear.svg",
  notion: "https://svgl.app/library/notion.svg",
  posthog: "https://svgl.app/library/posthog.svg",
  pylon: "/icons/mcp/pylon.svg",
  sentry: "https://svgl.app/library/sentry.svg",
  slack: "https://svgl.app/library/slack.svg",
  stripe: "https://svgl.app/library/stripe.svg",
  supabase: "https://svgl.app/library/supabase.svg",
  vercel: {
    dark: "https://svgl.app/library/vercel_dark.svg",
    light: "https://svgl.app/library/vercel.svg",
  },
  x: "https://svgl.app/library/x.svg",
} satisfies Partial<Record<McpProviderIconId, SvglRoute>>

function createSvglIcon(route: SvglRoute): ComponentType<McpProviderIconProps> {
  function SvglIcon({ className }: McpProviderIconProps) {
    const imgClassName = cn("object-contain", className)

    if (typeof route === "string") {
      return (
        <NextImage
          src={route}
          alt=""
          aria-hidden
          width={24}
          height={24}
          unoptimized
          className={imgClassName}
        />
      )
    }

    return (
      <>
        <NextImage
          src={route.light}
          alt=""
          aria-hidden
          width={24}
          height={24}
          unoptimized
          className={cn(imgClassName, "dark:hidden")}
        />
        <NextImage
          src={route.dark}
          alt=""
          aria-hidden
          width={24}
          height={24}
          unoptimized
          className={cn(imgClassName, "hidden dark:block")}
        />
      </>
    )
  }

  return SvglIcon
}

export const MCP_PROVIDER_ICONS: Partial<
  Record<McpProviderIconId, ComponentType<McpProviderIconProps>>
> = Object.fromEntries(
  Object.entries(MCP_PROVIDER_ICON_ROUTES).map(([provider, route]) => [
    provider,
    createSvglIcon(route),
  ])
)

export function mcpProviderIcon(provider: string | undefined) {
  return provider && provider in MCP_PROVIDER_ICONS
    ? MCP_PROVIDER_ICONS[provider as McpProviderIconId]
    : undefined
}

export function mcpServerPresetIcon(serverName: string | undefined) {
  return serverName === X_API_MCP_SERVER_NAME ||
    serverName === X_DOCS_MCP_SERVER_NAME
    ? mcpProviderIcon("x")
    : undefined
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-muted/50 py-1 pr-1 pl-2.5">
      <code className="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-xs text-foreground/80">
        {value}
      </code>
      <button
        type="button"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        title={copied ? "Copied" : "Copy"}
        className={iconBtn}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? (
          <Check className="size-3.5 text-success" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  )
}

function SetupStep({
  step,
  title,
  children,
}: {
  step: number
  title: string
  children?: React.ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
        {step}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-sm text-foreground/90">{title}</div>
        {children}
      </div>
    </li>
  )
}

const setupInput = cn(
  "w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground",
  "placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none"
)

function McpProviderSetupDialog({
  provider,
  onClose,
}: {
  provider: McpOauthProvider
  onClose: () => void
}) {
  const staticClient = provider.staticClientEnv
  const Icon = mcpProviderIcon(provider.id) ?? Plug
  const redirectUrl = `${window.location.origin}/api/mcp/oauth/callback`
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const ready = Boolean(clientId.trim() && clientSecret.trim())

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  if (!staticClient) return null

  return (
    <dialog
      open
      className="fixed inset-0 z-50 m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/40 p-4 backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      aria-modal="true"
      aria-label={`Set up ${provider.name}`}
      tabIndex={-1}
    >
      <button
        type="button"
        aria-label="Close setup dialog"
        tabIndex={-1}
        className="absolute inset-0 cursor-default border-0 bg-transparent p-0"
        onClick={onClose}
      />
      <form
        action="/api/mcp/oauth/start"
        method="post"
        className={cn(
          "relative z-10 w-full max-w-md overflow-hidden p-5",
          popoverSurfaceClass
        )}
      >
        <input type="hidden" name="provider" value={provider.id} />
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-base font-medium text-foreground">
              Set up {provider.name}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {provider.name} needs a one-time OAuth app. Create it, paste its
              credentials, and you are done — no configuration files.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close setup dialog"
            className={iconBtn}
          >
            <X className="size-3.5" />
          </button>
        </div>

        <ol className="mt-5 space-y-4">
          <SetupStep
            step={1}
            title={`Create an app in the ${provider.name} developer console.`}
          >
            <a
              href={staticClient.consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 underline underline-offset-2 transition-colors hover:text-foreground"
            >
              Open {provider.name} console
              <ArrowUpRight className="size-3" />
            </a>
            <p className={fieldHint}>{staticClient.setupHint}</p>
          </SetupStep>
          <SetupStep step={2} title="Add this redirect URL to the app.">
            <CopyField label="redirect URL" value={redirectUrl} />
          </SetupStep>
          <SetupStep step={3} title="Paste the app’s credentials here.">
            <input
              name="clientId"
              aria-label="Client ID"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="Client ID"
              autoComplete="off"
              spellCheck={false}
              className={setupInput}
            />
            <input
              name="clientSecret"
              type="password"
              aria-label="Client secret"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder="Client secret"
              autoComplete="off"
              spellCheck={false}
              className={setupInput}
            />
            <p className={fieldHint}>
              Stored encrypted with your account and only used to connect{" "}
              {provider.name}. You will not need them again.
            </p>
          </SetupStep>
        </ol>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={!ready}
            className={cn(
              navPrimary,
              "disabled:pointer-events-none disabled:opacity-50"
            )}
          >
            Connect {provider.name}
          </button>
        </div>
      </form>
    </dialog>
  )
}

function XApiMcpSetupDialog({
  existingServer,
  onClose,
  onSaved,
}: {
  existingServer?: McpServerRecord
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const Icon = mcpProviderIcon(X_API_MCP_PRESET.id) ?? Plug
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const ready = Boolean(clientId.trim() && clientSecret.trim())

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  async function savePreset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || saving) return

    setError("")
    setSaving(true)
    try {
      await requestJson<{ serverId?: Id<"mcpServers"> }>(
        "/api/mcp/custom",
        "POST",
        {
          args: X_API_MCP_PRESET.args,
          command: "npx",
          name: X_API_MCP_PRESET.serverName,
          secrets: [
            { name: "CLIENT_ID", value: clientId.trim() },
            { name: "CLIENT_SECRET", value: clientSecret.trim() },
          ],
          serverId: existingServer?.id,
          startupTimeoutSec: 300,
          toolTimeoutSec: 60,
          transport: "stdio",
        },
        { fallbackError: "Unable to save X MCP server." }
      )
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save X MCP.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog
      open
      className="fixed inset-0 z-50 m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/40 p-4 backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      aria-modal="true"
      aria-label="Set up X API"
      tabIndex={-1}
    >
      <button
        type="button"
        aria-label="Close setup dialog"
        tabIndex={-1}
        className="absolute inset-0 cursor-default border-0 bg-transparent p-0"
        onClick={onClose}
      />
      <form
        onSubmit={savePreset}
        className={cn(
          "relative z-10 w-full max-w-md overflow-hidden p-5",
          popoverSurfaceClass
        )}
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-base font-medium text-foreground">
              Set up X API
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              X API runs through the official xurl MCP bridge. Create an X app,
              paste its credentials, and Cloudcode will save the bridge as the
              xapi STDIO MCP server.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close setup dialog"
            className={iconBtn}
          >
            <X className="size-3.5" />
          </button>
        </div>

        <ol className="mt-5 space-y-4">
          <SetupStep step={1} title="Create an app in the X developer portal.">
            <a
              href={X_API_MCP_PRESET.consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 underline underline-offset-2 transition-colors hover:text-foreground"
            >
              Open X developer portal
              <ArrowUpRight className="size-3" />
            </a>
            <p className={fieldHint}>{X_API_MCP_PRESET.setupHint}</p>
          </SetupStep>
          <SetupStep step={2} title="Add this redirect URL to the app.">
            <CopyField
              label="redirect URL"
              value={X_API_MCP_PRESET.redirectUrl}
            />
          </SetupStep>
          <SetupStep step={3} title="Paste the app's credentials here.">
            <input
              aria-label="Client ID"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="Client ID"
              autoComplete="off"
              spellCheck={false}
              className={setupInput}
            />
            <input
              type="password"
              aria-label="Client secret"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder="Client secret"
              autoComplete="off"
              spellCheck={false}
              className={setupInput}
            />
            <p className={fieldHint}>
              Stored encrypted with your account as CLIENT_ID and CLIENT_SECRET
              for the xurl bridge.
            </p>
          </SetupStep>
        </ol>

        {error ? (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={!ready || saving}
            className={cn(
              navPrimary,
              "disabled:pointer-events-none disabled:opacity-50"
            )}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {existingServer ? "Reconnect X API" : "Connect X API"}
          </button>
        </div>
      </form>
    </dialog>
  )
}

/**
 * One-click OAuth integrations for the MCP settings section. Connected
 * providers show a checkmark; clicking one runs the OAuth flow again to
 * reconnect the account. Providers that need a pre-registered OAuth app and
 * are missing their credentials open a guided setup dialog instead.
 */
export function McpIntegrationsGrid({
  loading,
  onReload,
  servers,
}: {
  loading: boolean
  onReload: () => Promise<void>
  servers: McpServerRecord[]
}) {
  const connections = useQuery(api.mcpOauthConnections.list)
  const [setupRequired, setSetupRequired] = useState<Set<string> | null>(null)
  const [setupProvider, setSetupProvider] = useState<McpOauthProvider | null>(
    null
  )
  const [presetError, setPresetError] = useState("")
  const [savingPreset, setSavingPreset] = useState<string | null>(null)
  const [xSetupOpen, setXSetupOpen] = useState(false)
  const connectedProviders = new Set(
    (connections ?? [])
      .filter((connection) => connection.connected)
      .map((connection) => connection.provider)
  )
  const xServer = servers.find(
    (server) => server.serverName === X_API_MCP_SERVER_NAME
  )
  const xDocsServer = servers.find(
    (server) => server.serverName === X_DOCS_MCP_SERVER_NAME
  )
  const presetDisabled = loading || Boolean(savingPreset)

  async function saveXDocsPreset() {
    if (presetDisabled) return

    setPresetError("")
    setSavingPreset(X_DOCS_MCP_PRESET.serverName)
    try {
      await requestJson<{ serverId?: Id<"mcpServers"> }>(
        "/api/mcp/custom",
        "POST",
        {
          name: X_DOCS_MCP_PRESET.serverName,
          serverId: xDocsServer?.id,
          transport: "http",
          url: X_DOCS_MCP_PRESET.url,
        },
        { fallbackError: "Unable to save X Docs MCP server." }
      )
      await onReload()
    } catch (err) {
      setPresetError(
        err instanceof Error ? err.message : "Unable to save X Docs MCP."
      )
    } finally {
      setSavingPreset(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    void fetchJson<{ setupRequired?: string[] }>(
      "/api/mcp/oauth/providers",
      { method: "GET" },
      { fallbackError: "Unable to load MCP provider status." }
    )
      .then((data) => {
        if (!cancelled) setSetupRequired(new Set(data.setupRequired ?? []))
      })
      .catch(() => {
        if (!cancelled) setSetupRequired(new Set())
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div>
      <div className="mb-2.5 text-xs font-medium text-muted-foreground">
        Integrations
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {(() => {
          const Icon = mcpProviderIcon(X_API_MCP_PRESET.id) ?? Plug
          const connected = Boolean(xServer)
          return (
            <button
              type="button"
              disabled={presetDisabled}
              onClick={() => setXSetupOpen(true)}
              title={
                connected
                  ? "X API is connected. Click to reconnect."
                  : X_API_MCP_PRESET.description
              }
              className={cn(
                "group flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
                cardSurfaceClass
              )}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground/70 transition-colors group-hover:bg-background group-hover:text-foreground/90">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground/90">
                  {X_API_MCP_PRESET.name}
                </span>
                <span
                  className={cn(
                    "block truncate text-xs leading-4",
                    connected ? "text-success" : "text-muted-foreground"
                  )}
                >
                  {connected ? "Connected" : X_API_MCP_PRESET.tagline}
                </span>
              </span>
              {connected ? (
                <Check className="size-4 shrink-0 text-success" />
              ) : (
                <Plus className="size-4 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
              )}
            </button>
          )
        })()}
        {(() => {
          const Icon = mcpProviderIcon(X_API_MCP_PRESET.id) ?? Plug
          const connected = Boolean(xDocsServer)
          const saving = savingPreset === X_DOCS_MCP_PRESET.serverName
          return (
            <button
              type="button"
              disabled={presetDisabled}
              onClick={() => void saveXDocsPreset()}
              title={
                connected
                  ? "X Docs is connected. Click to reconnect."
                  : X_DOCS_MCP_PRESET.description
              }
              className={cn(
                "group flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
                cardSurfaceClass
              )}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground/70 transition-colors group-hover:bg-background group-hover:text-foreground/90">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground/90">
                  {X_DOCS_MCP_PRESET.name}
                </span>
                <span
                  className={cn(
                    "block truncate text-xs leading-4",
                    connected ? "text-success" : "text-muted-foreground"
                  )}
                >
                  {connected ? "Connected" : X_DOCS_MCP_PRESET.tagline}
                </span>
              </span>
              {saving ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : connected ? (
                <Check className="size-4 shrink-0 text-success" />
              ) : (
                <Plus className="size-4 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
              )}
            </button>
          )
        })()}
        {MCP_OAUTH_PROVIDERS.map((provider) => {
          const Icon = mcpProviderIcon(provider.id) ?? Plug
          const connected = connectedProviders.has(provider.id)
          const needsSetup =
            !connected &&
            setupRequired !== null &&
            setupRequired.has(provider.id)
          // Hold static-client tiles until their status loads so a click
          // never lands on a failing OAuth redirect.
          const statusPending =
            Boolean(provider.staticClientEnv) && setupRequired === null
          return (
            <form
              key={provider.id}
              action="/api/mcp/oauth/start"
              method="get"
              className="contents"
            >
              <input type="hidden" name="provider" value={provider.id} />
              <button
                type={needsSetup ? "button" : "submit"}
                disabled={statusPending}
                onClick={
                  needsSetup ? () => setSetupProvider(provider) : undefined
                }
                title={
                  connected
                    ? `${provider.name} is connected. Click to reconnect.`
                    : needsSetup
                      ? `${provider.name} needs a one-time OAuth app setup.`
                      : provider.description
                }
                className={cn(
                  "group flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted disabled:pointer-events-none",
                  cardSurfaceClass
                )}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground/70 transition-colors group-hover:bg-background group-hover:text-foreground/90">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground/90">
                    {provider.name}
                  </span>
                  <span
                    className={cn(
                      "block truncate text-xs leading-4",
                      connected ? "text-success" : "text-muted-foreground"
                    )}
                  >
                    {connected
                      ? "Connected"
                      : needsSetup
                        ? "Setup required"
                        : provider.tagline}
                  </span>
                </span>
                {connected ? (
                  <Check className="size-4 shrink-0 text-success" />
                ) : needsSetup ? (
                  <KeyRound className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                ) : (
                  <Plus className="size-4 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </button>
            </form>
          )
        })}
      </div>

      {presetError ? (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {presetError}
        </div>
      ) : null}

      {setupProvider ? (
        <McpProviderSetupDialog
          provider={setupProvider}
          onClose={() => setSetupProvider(null)}
        />
      ) : null}
      {xSetupOpen ? (
        <XApiMcpSetupDialog
          existingServer={xServer}
          onClose={() => setXSetupOpen(false)}
          onSaved={onReload}
        />
      ) : null}
    </div>
  )
}
