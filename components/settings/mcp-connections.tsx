"use client"

import { useQuery } from "convex/react"
import {
  ArrowUpRight,
  Check,
  Copy,
  KeyRound,
  Plug,
  Plus,
  X,
} from "lucide-react"
import NextImage from "next/image"
import { useEffect, useState, type ComponentType } from "react"

import { fieldHint } from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { cardSurfaceClass, popoverSurfaceClass } from "@/components/ui/surface"
import { api } from "@/convex/_generated/api"
import { fetchJson } from "@/lib/http/client-json"
import {
  MCP_OAUTH_PROVIDERS,
  type McpOauthProvider,
  type McpOauthProviderId,
} from "@/lib/mcp/oauth-providers"
import { cn } from "@/lib/shared/utils"

type McpProviderIconProps = { className?: string }
type SvglRoute = string | { dark: string; light: string }

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
  x: {
    dark: "https://svgl.app/library/x_dark.svg",
    light: "https://svgl.app/library/x.svg",
  },
} satisfies Partial<Record<McpOauthProviderId, SvglRoute>>

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
  Record<McpOauthProviderId, ComponentType<McpProviderIconProps>>
> = Object.fromEntries(
  Object.entries(MCP_PROVIDER_ICON_ROUTES).map(([provider, route]) => [
    provider,
    createSvglIcon(route),
  ])
)

export function mcpProviderIcon(provider: string | undefined) {
  return provider && provider in MCP_PROVIDER_ICONS
    ? MCP_PROVIDER_ICONS[provider as McpOauthProviderId]
    : undefined
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-muted/50 py-1 pr-1 pl-2.5">
      <code className="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-xs text-foreground/80">
        {value}
      </code>
      <IconButton
        size="sm"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        title={copied ? "Copied" : "Copy"}
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
      </IconButton>
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
          <IconButton
            size="sm"
            onClick={onClose}
            aria-label="Close setup dialog"
          >
            <X className="size-3.5" />
          </IconButton>
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
            <Input
              name="clientId"
              aria-label="Client ID"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="Client ID"
              autoComplete="off"
              spellCheck={false}
            />
            <Input
              name="clientSecret"
              type="password"
              aria-label="Client secret"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder="Client secret"
              autoComplete="off"
              spellCheck={false}
            />
            <p className={fieldHint}>
              Stored encrypted with your account and only used to connect{" "}
              {provider.name}. You will not need them again.
            </p>
          </SetupStep>
        </ol>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" size="sm" disabled={!ready}>
            Connect {provider.name}
          </Button>
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
export function McpIntegrationsGrid() {
  const connections = useQuery(api.mcpOauthConnections.list)
  const [setupRequired, setSetupRequired] = useState<Set<string> | null>(null)
  const [setupProvider, setSetupProvider] = useState<McpOauthProvider | null>(
    null
  )
  const connectedProviders = new Set(
    (connections ?? [])
      .filter((connection) => connection.connected)
      .map((connection) => connection.provider)
  )

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

      {setupProvider ? (
        <McpProviderSetupDialog
          provider={setupProvider}
          onClose={() => setSetupProvider(null)}
        />
      ) : null}
    </div>
  )
}
