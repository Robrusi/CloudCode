"use client"

import { useClerk, useUser } from "@clerk/nextjs"
import { useAction, useMutation, useQuery } from "convex/react"
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  ClipboardPaste,
  CornerDownRight,
  CreditCard,
  Globe,
  KeyRound,
  Layers3,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import type { SettingsSectionId } from "@/components/settings-sections"
import { GitHubIcon, OpenAIIcon } from "@/components/ui/brand-icons"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Switch } from "@/components/ui/switch"
import { popoverSurfaceClass } from "@/components/ui/surface"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type {
  CodexAuthAccountStatus,
  CodexAuthOverview,
} from "@/lib/codex-auth-types"
import {
  BILLING_PLANS,
  type BillingPlanId,
  planIncludedTimeLabel,
} from "@/lib/billing"
import { dedupeEnvVars, parseDotenv } from "@/lib/dotenv-parse"
import { cn } from "@/lib/utils"

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
  section,
  authStatus,
  authError,
  githubStatus,
  githubAuthError,
  onCodexAuthChanged,
  onGitHubAuthChanged,
  sandboxPresets,
}: {
  section: SettingsSectionId
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
        <div className="mx-auto w-full max-w-2xl px-4 pt-8 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:pt-12">
          {section === "connections" ? (
            <ConnectionsSettings
              authStatus={authStatus}
              authError={authError}
              githubStatus={githubStatus}
              githubAuthError={githubAuthError}
              onCodexAuthChanged={onCodexAuthChanged}
              onGitHubAuthChanged={onGitHubAuthChanged}
            />
          ) : null}
          {section === "billing" ? <BillingSettings /> : null}
          {section === "mcp" ? (
            <McpSettings
              error={mcpError}
              loading={mcpLoading}
              onReload={reloadMcpServers}
              servers={mcpServers}
            />
          ) : null}
          {section === "presets" ? <PresetSettings presets={presets} /> : null}
        </div>
      </div>
    </div>
  )
}

function SettingsPage({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-medium tracking-tight text-foreground/90">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

function ConnectionsSettings({
  authStatus,
  authError,
  githubStatus,
  githubAuthError,
  onCodexAuthChanged,
  onGitHubAuthChanged,
}: {
  authStatus: CodexAuthOverview | null
  authError: string
  githubStatus: GitHubAuthStatus | null
  githubAuthError: string
  onCodexAuthChanged: () => void | Promise<void>
  onGitHubAuthChanged: () => void | Promise<void>
}) {
  return (
    <SettingsPage
      title="Connections"
      description="Connect ChatGPT and GitHub to authorize Codex runs and repository access."
    >
      <div className="divide-y divide-border/60">
        <div className="pb-7">
          <ChatGPTConnectionRow
            status={authStatus}
            authError={authError}
            onCodexAuthChanged={onCodexAuthChanged}
          />
        </div>
        <div className="py-7">
          <GitHubConnectionRow
            status={githubStatus}
            error={githubAuthError}
            onGitHubAuthChanged={onGitHubAuthChanged}
          />
        </div>
        <div className="pt-7">
          <AccountRow />
        </div>
      </div>
    </SettingsPage>
  )
}

function AccountRow() {
  const clerk = useClerk()
  const { user } = useUser()
  const [signingOut, setSigningOut] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const title = user?.fullName || user?.username || "Account"

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await clerk.signOut()
    } catch (error) {
      console.warn("Unable to sign out.", error)
      setSigningOut(false)
    }
  }

  async function deleteAccount() {
    if (deleting) return
    setDeleting(true)
    setDeleteError("")
    try {
      const res = await fetch("/api/account", { method: "DELETE" })
      const data = (await res.json().catch(() => ({}))) as { error?: string }

      if (!res.ok) {
        throw new Error(data.error ?? "Unable to delete account.")
      }

      try {
        await clerk.signOut()
      } catch {
        // The Clerk user is already gone; just leave the app.
        window.location.assign("/")
      }
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Unable to delete account."
      )
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        {user?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.imageUrl}
            alt=""
            className="size-5 shrink-0 rounded-full"
          />
        ) : (
          <Circle className="size-5 shrink-0 text-foreground/80" />
        )}
        <div className="min-w-0 flex-1 text-sm font-medium text-foreground">
          {title}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-foreground/80"
          onClick={() => void signOut()}
          disabled={signingOut || deleting}
        >
          {signingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
          Log out
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setConfirmingDelete(true)}
          disabled={signingOut || deleting}
        >
          Delete account
        </Button>
      </div>
      {confirmingDelete ? (
        <ConfirmDialog
          title="Delete account?"
          description="This permanently deletes your account and everything associated with it: chats, sandboxes, presets, MCP servers, billing records, and the connected ChatGPT and GitHub credentials. This cannot be undone."
          confirmLabel="Delete account"
          confirmationPhrase="Delete account"
          destructive
          busy={deleting}
          error={deleteError}
          onCancel={() => {
            if (deleting) return
            setConfirmingDelete(false)
            setDeleteError("")
          }}
          onConfirm={() => void deleteAccount()}
        />
      ) : null}
    </div>
  )
}

type UsageHoursInfo = {
  depleted: boolean
  fractionRemaining: number
  nextResetAt: number | null
  runningHoursLeft: number
  runningMinutesLeft: number
  stoppedHoursLeft: number
  stoppedMinutesLeft: number
  unlimited: boolean
}

function formatSandboxTimeLeft(usage: UsageHoursInfo) {
  if (usage.depleted) return "0 minutes"
  if (usage.runningHoursLeft >= 1) {
    return `${usage.runningHoursLeft} ${usage.runningHoursLeft === 1 ? "hour" : "hours"}`
  }
  if (usage.runningMinutesLeft >= 1) {
    return `${usage.runningMinutesLeft} ${usage.runningMinutesLeft === 1 ? "minute" : "minutes"}`
  }
  return "<1 minute"
}

function formatPlanPrice(priceUsd: number) {
  return priceUsd === 0 ? "Free" : `$${priceUsd}/mo`
}

function billingPlanRank(planId: string | null | undefined) {
  return BILLING_PLANS.find((plan) => plan.planId === planId)?.priceUsd ?? 0
}

function formatPlanDetail({
  canceling,
  currentPeriodEnd,
  currentPlanId,
  scheduledPlanId,
}: {
  canceling: boolean
  currentPeriodEnd: number | null
  currentPlanId: string | null | undefined
  scheduledPlanId: BillingPlanId | null
}) {
  if (scheduledPlanId && scheduledPlanId !== currentPlanId) {
    const verb =
      billingPlanRank(scheduledPlanId) < billingPlanRank(currentPlanId)
        ? "Downgrades"
        : "Changes"
    return `${verb} to ${billingPlanName(scheduledPlanId)} next billing cycle`
  }

  if (canceling && currentPeriodEnd) {
    return `Cancels ${formatBillingDate(currentPeriodEnd)}`
  }

  if (currentPeriodEnd) {
    return `Renews ${formatBillingDate(currentPeriodEnd)}`
  }

  return "Your current plan"
}

function BillingSettings() {
  const billing = useQuery(api.billing.viewer)
  const attachPlan = useAction(api.billing.attachCurrentUserPlan)
  const cancelScheduledPlan = useAction(
    api.billing.cancelCurrentUserScheduledPlan
  )
  const refreshPlan = useAction(api.billing.refreshCurrentUserPlan)
  const [busyPlanId, setBusyPlanId] = useState<BillingPlanId | null>(null)
  const [cancelingScheduledPlan, setCancelingScheduledPlan] = useState(false)
  const [error, setError] = useState("")
  const [syncing, setSyncing] = useState(true)
  const [planDetail, setPlanDetail] = useState<{
    canceling: boolean
    currentPeriodEnd: number | null
    scheduledPlanId: BillingPlanId | null
  } | null>(null)
  const [usage, setUsage] = useState<UsageHoursInfo | null>(null)
  const currentPlanId = billing?.customer?.planId

  // The local record only stores the plan after a direct attach; hosted
  // checkouts settle on Autumn. Pull the live subscription so the page always
  // shows the real plan.
  useEffect(() => {
    let cancelled = false
    setSyncing(true)
    refreshPlan({})
      .then((plan) => {
        if (cancelled) return
        setPlanDetail({
          canceling: plan.canceling,
          currentPeriodEnd: plan.currentPeriodEnd,
          scheduledPlanId: plan.scheduledPlanId,
        })
        setUsage(plan.usage)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSyncing(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshPlan])

  const checking = !currentPlanId && (billing === undefined || syncing)

  async function purchasePlan(planId: BillingPlanId) {
    if (busyPlanId) return

    setBusyPlanId(planId)
    setError("")

    try {
      const successUrl = new URL(window.location.origin)
      successUrl.searchParams.set("view", "settings")
      const result = await attachPlan({
        planId,
        successUrl: successUrl.toString(),
      })

      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl)
        return
      }

      // Direct attach with no hosted checkout — pull the live renewal details.
      const plan = await refreshPlan({})
      setPlanDetail({
        canceling: plan.canceling,
        currentPeriodEnd: plan.currentPeriodEnd,
        scheduledPlanId: plan.scheduledPlanId,
      })
      setUsage(plan.usage)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start checkout.")
    } finally {
      setBusyPlanId(null)
    }
  }

  async function cancelPlanChange() {
    if (busyPlanId || cancelingScheduledPlan) return

    setCancelingScheduledPlan(true)
    setError("")

    try {
      const plan = await cancelScheduledPlan({})
      setPlanDetail({
        canceling: plan.canceling,
        currentPeriodEnd: plan.currentPeriodEnd,
        scheduledPlanId: plan.scheduledPlanId,
      })
      setUsage(plan.usage)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to cancel plan change."
      )
    } finally {
      setCancelingScheduledPlan(false)
    }
  }

  return (
    <SettingsPage
      title="Billing"
      description="Manage your subscription. Payments are handled securely through Autumn."
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <CreditCard className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            {checking ? (
              <div className="text-sm text-muted-foreground">
                Checking your plan…
              </div>
            ) : currentPlanId ? (
              <>
                <div className="text-sm font-medium text-foreground">
                  {billingPlanName(currentPlanId)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatPlanDetail({
                    canceling: Boolean(planDetail?.canceling),
                    currentPeriodEnd: planDetail?.currentPeriodEnd ?? null,
                    currentPlanId,
                    scheduledPlanId: planDetail?.scheduledPlanId ?? null,
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-foreground">
                  No active plan
                </div>
                <div className="text-xs text-muted-foreground">
                  Choose a plan to get started
                </div>
              </>
            )}
          </div>
          {checking ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        {usage ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {usage.unlimited ? (
                  <span className="font-medium text-foreground">
                    Unlimited sandbox usage
                  </span>
                ) : (
                  <>
                    <span className="font-medium text-foreground tabular-nums">
                      {formatSandboxTimeLeft(usage)}
                    </span>{" "}
                    of sandbox time left
                  </>
                )}
              </span>
              {usage.nextResetAt && !usage.unlimited ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  resets {formatBillingDate(usage.nextResetAt)}
                </span>
              ) : null}
            </div>

            <div
              aria-hidden
              className="relative h-2 w-full rounded-full bg-muted"
            >
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-[width]",
                  usage.fractionRemaining <= 0.15
                    ? "bg-destructive"
                    : "bg-foreground"
                )}
                style={{
                  width: usage.depleted
                    ? "0%"
                    : `${Math.max(usage.fractionRemaining * 100, 2)}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="text-[11px] leading-4 text-destructive">{error}</div>
        ) : null}

        <div className="divide-y divide-border/60 border-y border-border/60">
          {BILLING_PLANS.map((plan) => {
            const busy = busyPlanId === plan.planId
            const active = currentPlanId === plan.planId
            const scheduled = planDetail?.scheduledPlanId === plan.planId

            return (
              <div key={plan.planId} className="flex items-center gap-3 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {plan.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatPlanPrice(plan.priceUsd)} ·{" "}
                    {planIncludedTimeLabel(plan.includedMicroUsd)} of usage
                  </div>
                </div>
                {active ? (
                  <span className={cn(statusBadge, statusOk)}>
                    <Check className="size-3.5" />
                    Current plan
                  </span>
                ) : scheduled ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={cn(statusBadge, statusIdle)}>
                      <Clock className="size-3.5" />
                      Next cycle
                    </span>
                    <button
                      type="button"
                      disabled={Boolean(busyPlanId) || cancelingScheduledPlan}
                      onClick={() => void cancelPlanChange()}
                      className={navDestructive}
                    >
                      {cancelingScheduledPlan ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <X className="size-3.5" />
                      )}
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(busyPlanId)}
                    onClick={() => void purchasePlan(plan.planId)}
                    className={navPrimary}
                  >
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Choose
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </SettingsPage>
  )
}

function billingPlanName(planId: string) {
  return BILLING_PLANS.find((plan) => plan.planId === planId)?.name ?? planId
}

function formatBillingDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
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
      <div className="flex items-center gap-3">
        <OpenAIIcon className="size-5 shrink-0 text-foreground/80" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">ChatGPT</div>
          <div className="text-xs text-muted-foreground">{detail}</div>
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
      {visibleError ? (
        <div className="mt-2 text-[11px] leading-4 text-destructive">
          {visibleError}
        </div>
      ) : null}

      {accounts.length > 0 ? (
        <div className="mt-3 space-y-0.5">
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
                  className="flex items-center gap-2 rounded-xl bg-muted px-2.5 py-2"
                >
                  {active ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" />
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
                  "flex items-center gap-1.5 rounded-xl px-2.5 py-2 transition-colors",
                  active ? "bg-muted" : "hover:bg-muted/60",
                  busy && "opacity-80"
                )}
              >
                <button
                  type="button"
                  aria-pressed={active}
                  disabled={active || busy || Boolean(editingProfile)}
                  onClick={() => void selectProfile(account.profile)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:pointer-events-none"
                >
                  {active ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {codexAccountTitle(account)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {codexAccountSubtitle(account)}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
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
    <div>
      <div className="flex items-center gap-3">
        <GitHubIcon className="size-5 shrink-0 text-foreground/80" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">GitHub</div>
          <div className="text-xs text-muted-foreground">{detail}</div>
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

      {visibleError ? (
        <div className="mt-2 text-[11px] leading-4 text-destructive">
          {visibleError}
        </div>
      ) : null}

      {userReady && accounts.length > 0 ? (
        <div className="mt-3 space-y-0.5">
          {accounts.map((account) => {
            const targetId = /^\d+$/.test(account.id) ? account.id : undefined

            return (
              <div
                key={`${account.accountType}:${account.login}`}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/60"
              >
                <span
                  aria-hidden
                  className="grid size-4 shrink-0 place-items-center text-muted-foreground/70"
                >
                  <CornerDownRight className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
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
          })}
        </div>
      ) : null}
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
    const response = await fetch("/api/mcp/custom", {
      body: JSON.stringify({ serverId }),
      headers: { "content-type": "application/json" },
      method: "DELETE",
    })
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) {
      throw new Error(data.error ?? "Unable to remove MCP server.")
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
      description="Give Codex extra tools over STDIO or streamable HTTP."
      action={
        <button type="button" onClick={openCreate} className={navAction}>
          <Plus className="size-3.5" />
          Custom MCP
        </button>
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
            <button
              type="button"
              onClick={() => setCreatingCustom(false)}
              aria-label="Close custom MCP editor"
              className={iconBtn}
            >
              <X className="size-3.5" />
            </button>
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
                  <TransportIcon
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
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">
                          Available to Codex
                        </div>
                        <p className={fieldHint}>
                          When off, this server is excluded from new Codex runs.
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

                    {toggleError ? (
                      <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {toggleError}
                      </div>
                    ) : null}

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
                  </div>
                ) : null}
              </div>
            )
          })
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <Server className="size-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">
                No MCP servers connected
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect a custom MCP server to give Codex extra tools over STDIO
                or HTTP.
              </p>
            </div>
            <button type="button" onClick={openCreate} className={navAction}>
              <Plus className="size-3.5" />
              Custom MCP
            </button>
          </div>
        )}
      </div>
    </SettingsPage>
  )
}

function McpServerForm({
  server,
  onSaved,
  onCancel,
  onRemove,
}: {
  server?: McpServerRecord
  onSaved: (serverId: Id<"mcpServers">) => void | Promise<void>
  onCancel: () => void
  onRemove?: () => void | Promise<void>
}) {
  const editing = Boolean(server)
  const [transport, setTransport] = useState<"stdio" | "http">(
    server?.transport ?? "stdio"
  )
  const [name, setName] = useState(server?.name ?? "")
  const [command, setCommand] = useState(server?.command ?? "")
  const [url, setUrl] = useState(server?.url ?? "")
  const [bearerTokenEnvVar, setBearerTokenEnvVar] = useState(
    server?.bearerTokenEnvVar ?? ""
  )
  const [cwd, setCwd] = useState(server?.cwd ?? "")
  const [args, setArgs] = useState<string[]>(server?.args ?? [])
  const [envVars, setEnvVars] = useState<
    Array<{ name: string; value: string }>
  >([])
  const [passthroughVars, setPassthroughVars] = useState<string[]>(
    server?.envVars ?? []
  )
  const [headers, setHeaders] = useState<
    Array<{ name: string; value: string }>
  >([])
  const [envHeaders, setEnvHeaders] = useState<
    Array<{ name: string; value: string }>
  >([])
  const [removeSecretIds, setRemoveSecretIds] = useState<
    Array<Id<"mcpServerSecrets">>
  >([])
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState("")

  const remainingSecrets = (server?.secrets ?? []).filter(
    (secret) => !removeSecretIds.includes(secret.id)
  )
  const savedEnv = remainingSecrets.filter((secret) => secret.kind === "env")
  const savedHeaders = remainingSecrets.filter(
    (secret) => secret.kind === "httpHeader"
  )
  const savedEnvHeaders = remainingSecrets.filter(
    (secret) => secret.kind === "envHttpHeader"
  )

  function removeSavedSecret(id: Id<"mcpServerSecrets">) {
    setRemoveSecretIds((prev) => [...prev, id])
  }

  async function save() {
    setSaving(true)
    setError("")
    try {
      const cleanList = (values: string[]) =>
        values.map((value) => value.trim()).filter(Boolean)
      const cleanPairs = (values: Array<{ name: string; value: string }>) =>
        values
          .map((pair) => ({ name: pair.name.trim(), value: pair.value.trim() }))
          .filter((pair) => pair.name && pair.value)
      const response = await fetch("/api/mcp/custom", {
        body: JSON.stringify({
          args: cleanList(args),
          bearerTokenEnvVar,
          command,
          cwd,
          envHttpHeaders: cleanPairs(envHeaders),
          envVars: cleanList(passthroughVars),
          httpHeaders: cleanPairs(headers),
          name,
          secrets: cleanPairs(envVars),
          transport,
          url,
          ...(editing && server
            ? { removeSecretIds, serverId: server.id }
            : {}),
        }),
        headers: { "content-type": "application/json" },
        method: editing ? "PATCH" : "POST",
      })
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
        serverId?: Id<"mcpServers">
      }
      if (!response.ok || !data.serverId) {
        throw new Error(data.error ?? "Unable to save MCP server.")
      }
      await onSaved(data.serverId)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save MCP server."
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!onRemove) return
    setRemoving(true)
    setError("")
    try {
      await onRemove()
    } catch (err) {
      setRemoving(false)
      setError(
        err instanceof Error ? err.message : "Unable to remove MCP server."
      )
    }
  }

  return (
    <div className="grid gap-4">
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
            items={args}
            label="Arguments"
            placeholder="--project"
            onChange={setArgs}
          />

          <McpSavedSecretList
            label="Environment variables"
            secrets={savedEnv}
            onRemove={removeSavedSecret}
          />

          <McpPairListEditor
            addLabel="Add environment variable"
            items={envVars}
            label={
              savedEnv.length
                ? "Add environment variables"
                : "Environment variables"
            }
            leftPlaceholder="Key"
            rightPlaceholder="Value"
            secret
            onChange={setEnvVars}
          />

          <McpStringListEditor
            addLabel="Add variable"
            items={passthroughVars}
            label="Environment variable passthrough"
            placeholder="GITHUB_TOKEN"
            onChange={setPassthroughVars}
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
              onChange={(event) => setBearerTokenEnvVar(event.target.value)}
              placeholder="MCP_BEARER_TOKEN"
              className={cn(inputClass, "font-normal")}
            />
          </label>
          <McpSavedSecretList
            label="Headers"
            secrets={savedHeaders}
            onRemove={removeSavedSecret}
          />
          <McpPairListEditor
            addLabel="Add header"
            items={headers}
            label={savedHeaders.length ? "Add headers" : "Headers"}
            leftPlaceholder="Key"
            rightPlaceholder="Value"
            secret
            onChange={setHeaders}
          />
          <McpSavedSecretList
            label="Headers from environment variables"
            secrets={savedEnvHeaders}
            onRemove={removeSavedSecret}
          />
          <McpPairListEditor
            addLabel="Add variable"
            items={envHeaders}
            label={
              savedEnvHeaders.length
                ? "Add headers from environment variables"
                : "Headers from environment variables"
            }
            leftPlaceholder="Header"
            rightPlaceholder="Env var"
            onChange={setEnvHeaders}
          />
        </>
      )}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        {editing && onRemove ? (
          <button
            type="button"
            onClick={handleRemove}
            disabled={saving || removing}
            className={navDestructive}
          >
            <Trash2 className="size-3.5" />
            {removing ? "Removing" : "Remove"}
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving || removing}
            className={navAction}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={
              saving ||
              removing ||
              !name.trim() ||
              (transport === "stdio" ? !command.trim() : !url.trim())
            }
            className={navPrimary}
          >
            {saving ? "Saving" : editing ? "Save changes" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}

function McpSavedSecretList({
  label,
  secrets,
  onRemove,
}: {
  label: string
  secrets: Array<{ id: Id<"mcpServerSecrets">; name: string }>
  onRemove: (id: Id<"mcpServerSecrets">) => void
}) {
  if (!secrets.length) return null
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-foreground/80">{label}</div>
      <div className="overflow-hidden rounded-lg border border-border/60">
        {secrets.map((secret) => (
          <div
            key={secret.id}
            className="flex items-center gap-2 border-b border-border/60 px-3 py-2 last:border-0"
          >
            <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-xs text-foreground/85">
              {secret.name}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              Saved
            </span>
            <button
              type="button"
              onClick={() => onRemove(secret.id)}
              aria-label={`Remove ${secret.name}`}
              className={cn(iconBtn, "hover:text-destructive")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function McpRemoveRowButton({
  hidden,
  label,
  onRemove,
}: {
  hidden: boolean
  label: string
  onRemove: () => void
}) {
  return (
    <IconButton
      type="button"
      onClick={onRemove}
      disabled={hidden}
      tabIndex={hidden ? -1 : undefined}
      aria-hidden={hidden}
      aria-label={label}
      className={cn(
        "hover:bg-destructive/10 hover:text-destructive",
        hidden && "pointer-events-none invisible"
      )}
    >
      <Trash2 className="size-3.5" />
    </IconButton>
  )
}

function McpStringListEditor({
  addLabel,
  items,
  label,
  placeholder,
  onChange,
}: {
  addLabel: string
  items: string[]
  label: string
  placeholder: string
  onChange: (items: string[]) => void
}) {
  const rows = items.length ? items : [""]
  const canRemove = items.length > 0
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-foreground/80">{label}</div>
      {rows.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            aria-label={`${label} ${index + 1}`}
            value={item}
            onChange={(event) => {
              const next = rows.slice()
              next[index] = event.target.value
              onChange(next)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                onChange([...rows, ""])
              }
            }}
            placeholder={placeholder}
            className={cn(
              inputClass,
              "font-[family-name:var(--font-mono)] text-xs"
            )}
          />
          <McpRemoveRowButton
            hidden={!canRemove}
            label={`Remove ${label} ${index + 1}`}
            onRemove={() => onChange(rows.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className={navAction}
      >
        <Plus className="size-3.5" />
        {addLabel}
      </button>
    </div>
  )
}

function McpPairListEditor({
  addLabel,
  items,
  label,
  leftPlaceholder,
  rightPlaceholder,
  secret,
  onChange,
}: {
  addLabel: string
  items: Array<{ name: string; value: string }>
  label: string
  leftPlaceholder: string
  rightPlaceholder: string
  secret?: boolean
  onChange: (items: Array<{ name: string; value: string }>) => void
}) {
  const rows = items.length ? items : [{ name: "", value: "" }]
  const canRemove = items.length > 0
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium text-foreground/80">{label}</div>
      {rows.map((item, index) => {
        const update = (field: "name" | "value", value: string) => {
          const next = rows.slice()
          next[index] = { ...next[index], [field]: value }
          onChange(next)
        }
        return (
          <div
            key={index}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
          >
            <input
              aria-label={`${label} name ${index + 1}`}
              value={item.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder={leftPlaceholder}
              className={cn(
                inputClass,
                "font-[family-name:var(--font-mono)] text-xs"
              )}
            />
            <input
              aria-label={`${label} value ${index + 1}`}
              value={item.value}
              onChange={(event) => update("value", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  onChange([...rows, { name: "", value: "" }])
                }
              }}
              placeholder={rightPlaceholder}
              type={secret ? "password" : undefined}
              className={cn(
                inputClass,
                "text-xs",
                !secret && "font-[family-name:var(--font-mono)]"
              )}
            />
            <McpRemoveRowButton
              hidden={!canRemove}
              label={`Remove ${label} ${index + 1}`}
              onRemove={() => onChange(rows.filter((_, i) => i !== index))}
            />
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => onChange([...items, { name: "", value: "" }])}
        className={navAction}
      >
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

  const presetFields = (
    <>
      <div className="grid gap-4">
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
              repo&apos;s cloudcode.yaml first. If the repo does not have one,
              it uses the saved Convex cloudcode.yaml for the live sandbox.
            </p>
            {selected?.environments?.length ? (
              <div className="mt-3 border-y border-border/60">
                {selected.environments.map((environment) => (
                  <div
                    key={environment.id}
                    className="flex items-center gap-2 border-b border-border/60 py-2 last:border-0"
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
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground/80">
                  Auto environment
                </div>
                <p className={fieldHint}>
                  Use the repo&apos;s cloudcode.yaml for each live chat sandbox,
                  falling back to the saved Convex cloudcode.yaml when the repo
                  does not include one. The scripts and secrets below run after
                  the environment is ready.
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
              <div className="border-y border-border/60">
                {selected.environments.map((environment) => (
                  <div
                    key={environment.id}
                    className="flex items-center gap-2 border-b border-border/60 py-2 last:border-0"
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
                onChange={(event) => setPathInstallScript(event.target.value)}
                placeholder={
                  "curl -fsSL https://vite.plus | bash\nnpm install -g vercel"
                }
                spellCheck={false}
                className={cn(textareaClass, "min-h-24 font-normal")}
              />
              <span className={fieldHint}>
                Runs from the sandbox home before repo setup. Use it for CLIs
                and language tools that should be available on PATH.
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
                Runs from the cloned repo root before Codex starts. Leave blank
                when the base environment already has everything.
              </span>
            </label>

            <div className="border-t border-border/60 pt-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground/80">
                <KeyRound className="size-3.5 text-muted-foreground" />
                Secrets
                {selected?.secrets.length ? (
                  <span className={metaPill}>{selected.secrets.length}</span>
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
                <div className="mb-3 border-y border-border/60">
                  {selected.secrets.map((secret) => (
                    <div
                      key={secret.id}
                      className="flex items-center gap-2 border-b border-border/60 py-2 last:border-0"
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
                                  parsedImport.errors.length === 1 ? "" : "s"
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

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
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
    </>
  )

  return (
    <SettingsPage
      title="Daytona Presets"
      description="Configure sandbox environments, install scripts, and secrets."
      action={
        <button type="button" onClick={startNewPreset} className={navAction}>
          <Plus className="size-3.5" />
          New preset
        </button>
      }
    >
      {creating ? (
        <div className="rounded-2xl border border-border/60 bg-muted/40 p-4 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                New preset
              </div>
              <div className="text-xs text-muted-foreground">
                Configure a sandbox preset
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
          {presetFields}
        </div>
      ) : null}

      <div className="space-y-2">
        {presets.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <Layers3 className="size-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">
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
              <div
                key={preset.id}
                className={cn(
                  "overflow-hidden rounded-xl border border-border/60 transition-colors",
                  active && "bg-muted/40"
                )}
              >
                <button
                  type="button"
                  onClick={() =>
                    active ? resetEditor() : selectPreset(preset)
                  }
                  aria-expanded={active}
                  className={cn(
                    "group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                    active ? "" : "hover:bg-muted"
                  )}
                >
                  <Layers3 className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {preset.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {subtitle}
                    </div>
                  </div>
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
                  <div className="px-3 pb-3">
                    <div className="border-t border-border/60 pt-3">
                      {presetFields}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </SettingsPage>
  )
}
