import { v } from "convex/values"

import type { Doc, Id } from "./_generated/dataModel"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { findCodexAuth } from "./lib/codexRunAuth"
import { activeRunForThread } from "./lib/codexRunLifecycle"
import { model, thinking } from "./lib/codexRunValidators"
import { insertFactoryRunRecords } from "./lib/factoryRuns"
import {
  deleteManagedIntegrationMcpServer,
  ensureManagedIntegrationMcpServer,
  ensureManagedIntegrationMcpServersForUser,
} from "./lib/integrationMcp"
import { integrationProvider } from "./lib/integrationTriggers"
import { resolveOwnedPresetOrAutoDefault } from "./lib/sandboxPresets"
import { threadContinuationInput } from "./lib/threadContinuation"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"
import {
  codexAuthMissingMessage,
  codexAuthReconnectMessage,
} from "@/lib/codex/auth-errors"
import { assertModelSupportsThinking } from "@/lib/chat/options"
import { canonicalGitHubRepoUrl } from "@/lib/github/repo"
import { linearAgentSessionThreadParts } from "@/lib/integrations/linear-threads"

// Session defaults for runs started from Slack/Linear. Follow-up runs on an
// existing bridge reuse the thread's previous run options instead.
const INTEGRATION_RUN_MODEL = "gpt-5.5" as const
const INTEGRATION_RUN_EFFORT = "medium" as const
const INTEGRATION_RUN_SPEED = "standard" as const

const THREAD_TITLE_MAX_LENGTH = 120
const PENDING_MESSAGES_MAX = 20
const QUEUED_LOG_MESSAGE = "Queued Codex run"

function integrationThreadTitle(title: string) {
  const base = title.trim().split("\n", 1)[0]?.trim() || "Integration session"
  return base.length > THREAD_TITLE_MAX_LENGTH
    ? `${base.slice(0, THREAD_TITLE_MAX_LENGTH)}…`
    : base
}

async function installationForProviderExternal(
  ctx: QueryCtx | MutationCtx,
  provider: Doc<"integrationInstallations">["provider"],
  externalId: string
) {
  return await ctx.db
    .query("integrationInstallations")
    .withIndex("by_provider_external", (q) =>
      q.eq("provider", provider).eq("externalId", externalId)
    )
    .first()
}

async function bridgeForExternalThread(
  ctx: QueryCtx | MutationCtx,
  provider: Doc<"integrationThreads">["provider"],
  externalThreadId: string
) {
  return await ctx.db
    .query("integrationThreads")
    .withIndex("by_external", (q) =>
      q.eq("provider", provider).eq("externalThreadId", externalThreadId)
    )
    .unique()
}

/** Exact bridge lookup for current identifiers, with a migration bridge for
 * Linear rows created when comment IDs were incorrectly part of the durable
 * thread identity. Multiple legacy rows can exist; the latest is canonical. */
async function bridgeForEvent(
  ctx: QueryCtx | MutationCtx,
  provider: Doc<"integrationThreads">["provider"],
  externalThreadId: string,
  linearOrganizationId?: string,
  linearAgentSessionId?: string
) {
  const exact = await bridgeForExternalThread(ctx, provider, externalThreadId)
  if (
    exact ||
    provider !== "linear" ||
    !linearOrganizationId ||
    !linearAgentSessionId
  ) {
    return exact
  }

  return await ctx.db
    .query("integrationThreads")
    .withIndex("by_linear_session", (q) =>
      q
        .eq("provider", "linear")
        .eq("linearOrganizationId", linearOrganizationId)
        .eq("linearAgentSessionId", linearAgentSessionId)
    )
    .order("desc")
    .first()
}

function canonicalLinearBridgeIdentity(
  provider: Doc<"integrationThreads">["provider"],
  externalThreadId: string,
  linearOrganizationId: string | undefined,
  linearAgentSessionId: string | undefined,
  storedExternalThreadId: string
) {
  if (
    provider !== "linear" ||
    !linearAgentSessionId ||
    storedExternalThreadId === externalThreadId
  ) {
    return undefined
  }
  return {
    externalThreadId,
    linearAgentSessionId,
    linearOrganizationId,
  }
}

async function requireOwnedInstallation(
  ctx: MutationCtx,
  installationId: Id<"integrationInstallations">,
  userId: Id<"users">
) {
  const installation = await ctx.db.get(installationId)
  if (!installation || installation.userId !== userId) {
    throw new Error("Integration not found.")
  }
  return installation
}

/** Disable automations that fire from the given installation, so a removed
 * integration never leaves orphaned event triggers behind. */
async function disableInstallationAutomations(
  ctx: MutationCtx,
  installation: Doc<"integrationInstallations">,
  reason: string
) {
  const automations = await ctx.db
    .query("automations")
    .withIndex("by_user_updated", (q) => q.eq("userId", installation.userId))
    .collect()

  for (const automation of automations) {
    const trigger = automation.trigger
    if (
      trigger &&
      trigger.kind !== "cron" &&
      trigger.installationId === installation._id &&
      automation.enabled
    ) {
      await ctx.db.patch(automation._id, {
        disabledReason: reason,
        enabled: false,
        nextRunAt: undefined,
        updatedAt: Date.now(),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Settings surface (Clerk-authed).
// ---------------------------------------------------------------------------

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []

    const installations = await ctx.db
      .query("integrationInstallations")
      .withIndex("by_user_provider", (q) => q.eq("userId", user._id))
      .collect()

    return await Promise.all(
      installations.map(async (installation) => {
        const credential =
          installation.provider === "slack"
            ? await ctx.db
                .query("integrationMcpCredentials")
                .withIndex("by_installation", (q) =>
                  q.eq("installationId", installation._id)
                )
                .unique()
            : null
        return {
          botUserId: installation.botUserId,
          defaultBaseBranch: installation.defaultBaseBranch,
          defaultModel: installation.defaultModel,
          defaultReasoningEffort: installation.defaultReasoningEffort,
          defaultRepoUrl: installation.defaultRepoUrl,
          defaultSandboxPresetId: installation.defaultSandboxPresetId,
          enabled: installation.enabled,
          externalId: installation.externalId,
          externalName: installation.externalName,
          id: installation._id,
          mcpEnabled: installation.mcpEnabled !== false,
          mcpReady: installation.provider === "linear" || Boolean(credential),
          mcpScopes: credential?.scopes,
          provider: installation.provider,
          updatedAt: installation.updatedAt,
        }
      })
    )
  },
})

export const saveInstallation = mutation({
  args: {
    botUserId: v.optional(v.string()),
    externalId: v.string(),
    externalName: v.optional(v.string()),
    provider: integrationProvider,
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const externalId = args.externalId.trim()
    if (!externalId) throw new Error("externalId is required.")

    const now = Date.now()
    const existing = await installationForProviderExternal(
      ctx,
      args.provider,
      externalId
    )
    if (existing && existing.userId !== userId) {
      throw new Error(
        "This workspace is already connected by another CloudCode user."
      )
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        botUserId: args.botUserId ?? existing.botUserId,
        enabled: true,
        externalName: args.externalName ?? existing.externalName,
        updatedAt: now,
      })
      const updated = await ctx.db.get(existing._id)
      if (updated) await ensureManagedIntegrationMcpServer(ctx, updated)
      return { installationId: existing._id }
    }

    const installationId = await ctx.db.insert("integrationInstallations", {
      botUserId: args.botUserId,
      createdAt: now,
      enabled: true,
      externalId,
      externalName: args.externalName,
      mcpEnabled: true,
      provider: args.provider,
      updatedAt: now,
      userId,
    })
    const installation = await ctx.db.get(installationId)
    if (installation) await ensureManagedIntegrationMcpServer(ctx, installation)
    return { installationId }
  },
})

export const updateSettings = mutation({
  args: {
    // "" clears a stored preset back to the auto default.
    clearDefaultSandboxPreset: v.optional(v.boolean()),
    defaultBaseBranch: v.optional(v.string()),
    defaultModel: v.optional(model),
    defaultReasoningEffort: v.optional(thinking),
    defaultRepoUrl: v.optional(v.string()),
    defaultSandboxPresetId: v.optional(v.id("sandboxPresets")),
    enabled: v.optional(v.boolean()),
    installationId: v.id("integrationInstallations"),
    mcpEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const installation = await requireOwnedInstallation(
      ctx,
      args.installationId,
      userId
    )
    assertModelSupportsThinking(
      args.defaultModel ?? installation.defaultModel ?? INTEGRATION_RUN_MODEL,
      args.defaultReasoningEffort ??
        installation.defaultReasoningEffort ??
        INTEGRATION_RUN_EFFORT
    )

    if (args.defaultSandboxPresetId) {
      const preset = await ctx.db.get(args.defaultSandboxPresetId)
      if (!preset || preset.userId !== userId) {
        throw new Error("Sandbox preset not found.")
      }
    }

    // Canonicalize so integration sessions share environments and sandboxes
    // with app sessions on the same repository — the auto-environment cache
    // keys by exact repoUrl string.
    const trimmedRepoUrl = args.defaultRepoUrl?.trim()
    await ctx.db.patch(installation._id, {
      ...(args.defaultBaseBranch !== undefined
        ? { defaultBaseBranch: args.defaultBaseBranch.trim() || undefined }
        : {}),
      ...(args.defaultModel !== undefined
        ? { defaultModel: args.defaultModel }
        : {}),
      ...(args.defaultReasoningEffort !== undefined
        ? { defaultReasoningEffort: args.defaultReasoningEffort }
        : {}),
      ...(args.defaultRepoUrl !== undefined
        ? {
            defaultRepoUrl: trimmedRepoUrl
              ? (canonicalGitHubRepoUrl(trimmedRepoUrl) ?? trimmedRepoUrl)
              : undefined,
          }
        : {}),
      ...(args.clearDefaultSandboxPreset
        ? { defaultSandboxPresetId: undefined }
        : args.defaultSandboxPresetId !== undefined
          ? { defaultSandboxPresetId: args.defaultSandboxPresetId }
          : {}),
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
      ...(args.mcpEnabled !== undefined ? { mcpEnabled: args.mcpEnabled } : {}),
      updatedAt: Date.now(),
    })

    const updated = await ctx.db.get(installation._id)
    if (updated) await ensureManagedIntegrationMcpServer(ctx, updated)

    if (args.enabled === false) {
      await disableInstallationAutomations(
        ctx,
        installation,
        "The connected integration was disabled. Re-enable it to resume this automation."
      )
    }
  },
})

export const removeInstallation = mutation({
  args: {
    installationId: v.id("integrationInstallations"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const installation = await requireOwnedInstallation(
      ctx,
      args.installationId,
      userId
    )

    await disableInstallationAutomations(
      ctx,
      installation,
      "The connected integration was removed. Reconnect it and edit the automation to resume."
    )
    const credential = await ctx.db
      .query("integrationMcpCredentials")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", installation._id)
      )
      .unique()
    if (credential) await ctx.db.delete(credential._id)
    await deleteManagedIntegrationMcpServer(ctx, installation._id)
    // Bridges stay: their threads keep their history, they just stop
    // receiving events once the installation row is gone.
    await ctx.db.delete(installation._id)
  },
})

export const saveMcpCredential = mutation({
  args: {
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    externalUserId: v.optional(v.string()),
    installationId: v.id("integrationInstallations"),
    provider: integrationProvider,
    scopes: v.optional(v.array(v.string())),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const userId = await ensureCurrentUser(ctx)
    const installation = await requireOwnedInstallation(
      ctx,
      args.installationId,
      userId
    )
    if (installation.provider !== args.provider) {
      throw new Error("Integration provider does not match the credential.")
    }

    const existing = await ctx.db
      .query("integrationMcpCredentials")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", installation._id)
      )
      .unique()
    const now = Date.now()
    const fields = {
      encryptedAccessToken: args.encryptedAccessToken,
      encryptedRefreshToken: args.encryptedRefreshToken,
      expiresAt: args.expiresAt,
      externalUserId: args.externalUserId,
      provider: args.provider,
      refreshLeaseExpiresAt: undefined,
      refreshLeaseId: undefined,
      scopes: args.scopes,
      updatedAt: now,
    }
    if (existing) {
      await ctx.db.patch(existing._id, fields)
      return existing._id
    }
    return await ctx.db.insert("integrationMcpCredentials", {
      ...fields,
      createdAt: now,
      installationId: installation._id,
      userId,
    })
  },
})

export const getInstallationForDisconnect = query({
  args: {
    installationId: v.id("integrationInstallations"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const user = await getCurrentUser(ctx)
    if (!user) return null
    const installation = await ctx.db.get(args.installationId)
    if (!installation || installation.userId !== user._id) return null
    const credential = await ctx.db
      .query("integrationMcpCredentials")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", installation._id)
      )
      .unique()
    return {
      encryptedMcpAccessToken: credential?.encryptedAccessToken,
      externalId: installation.externalId,
      provider: installation.provider,
    }
  },
})

const INTEGRATION_MCP_REFRESH_LEASE_MS = 60_000

export const workerBeginMcpCredentialRefresh = mutation({
  args: {
    installationId: v.id("integrationInstallations"),
    leaseId: v.string(),
    refreshBefore: v.number(),
    runId: v.id("codexRuns"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const [run, installation] = await Promise.all([
      ctx.db.get(args.runId),
      ctx.db.get(args.installationId),
    ])
    if (!run || !installation || run.userId !== installation.userId) {
      throw new Error("Integration MCP credential not found.")
    }
    const credential = await ctx.db
      .query("integrationMcpCredentials")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", installation._id)
      )
      .unique()
    if (!credential) throw new Error("Integration MCP credential not found.")

    const current = {
      encryptedAccessToken: credential.encryptedAccessToken,
      encryptedRefreshToken: credential.encryptedRefreshToken,
      expiresAt: credential.expiresAt,
    }
    if (
      credential.expiresAt === undefined ||
      credential.expiresAt > args.refreshBefore
    ) {
      return { credential: current, status: "current" as const }
    }

    const now = Date.now()
    if (
      credential.refreshLeaseId &&
      credential.refreshLeaseId !== args.leaseId &&
      (credential.refreshLeaseExpiresAt ?? 0) > now
    ) {
      return {
        retryAfterMs: Math.min(
          5_000,
          Math.max(250, (credential.refreshLeaseExpiresAt ?? now) - now)
        ),
        status: "wait" as const,
      }
    }

    await ctx.db.patch(credential._id, {
      refreshLeaseExpiresAt: now + INTEGRATION_MCP_REFRESH_LEASE_MS,
      refreshLeaseId: args.leaseId,
      updatedAt: now,
    })
    return { credential: current, status: "acquired" as const }
  },
})

export const workerCompleteMcpCredentialRefresh = mutation({
  args: {
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    installationId: v.id("integrationInstallations"),
    leaseId: v.string(),
    runId: v.id("codexRuns"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const [run, installation] = await Promise.all([
      ctx.db.get(args.runId),
      ctx.db.get(args.installationId),
    ])
    if (!run || !installation || run.userId !== installation.userId) {
      throw new Error("Integration MCP credential not found.")
    }
    const credential = await ctx.db
      .query("integrationMcpCredentials")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", installation._id)
      )
      .unique()
    if (!credential || credential.refreshLeaseId !== args.leaseId) {
      throw new Error("Integration MCP refresh lease was lost.")
    }
    await ctx.db.patch(credential._id, {
      encryptedAccessToken: args.encryptedAccessToken,
      encryptedRefreshToken:
        args.encryptedRefreshToken ?? credential.encryptedRefreshToken,
      expiresAt: args.expiresAt,
      refreshLeaseExpiresAt: undefined,
      refreshLeaseId: undefined,
      updatedAt: Date.now(),
    })
    return { saved: true }
  },
})

export const workerReleaseMcpCredentialRefresh = mutation({
  args: {
    installationId: v.id("integrationInstallations"),
    leaseId: v.string(),
    runId: v.id("codexRuns"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const [run, installation] = await Promise.all([
      ctx.db.get(args.runId),
      ctx.db.get(args.installationId),
    ])
    if (!run || !installation || run.userId !== installation.userId) {
      return { released: false }
    }
    const credential = await ctx.db
      .query("integrationMcpCredentials")
      .withIndex("by_installation", (q) =>
        q.eq("installationId", installation._id)
      )
      .unique()
    if (!credential || credential.refreshLeaseId !== args.leaseId) {
      return { released: false }
    }
    await ctx.db.patch(credential._id, {
      refreshLeaseExpiresAt: undefined,
      refreshLeaseId: undefined,
      updatedAt: Date.now(),
    })
    return { released: true }
  },
})

export const ensureManagedMcpServers = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await ensureCurrentUser(ctx)
    await ensureManagedIntegrationMcpServersForUser(ctx, userId)
    return { ensured: true }
  },
})

// Deployment backfill for existing connections. Safe to rerun; the helper
// only writes when a managed server is missing or its fixed metadata changed.
export const backfillManagedMcpServers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const installations = await ctx.db
      .query("integrationInstallations")
      .collect()
    for (const installation of installations) {
      await ensureManagedIntegrationMcpServer(ctx, installation)
    }
    return { ensured: installations.length }
  },
})

// One-time cleanup for installations saved before repo URLs were
// canonicalized on write. Idempotent; run with
//   npx convex run integrations:canonicalizeInstallationRepoUrls
export const canonicalizeInstallationRepoUrls = internalMutation({
  args: {},
  handler: async (ctx) => {
    const installations = await ctx.db
      .query("integrationInstallations")
      .collect()

    let updated = 0
    for (const installation of installations) {
      if (!installation.defaultRepoUrl) continue
      const canonical = canonicalGitHubRepoUrl(installation.defaultRepoUrl)
      if (canonical && canonical !== installation.defaultRepoUrl) {
        await ctx.db.patch(installation._id, {
          defaultRepoUrl: canonical,
          updatedAt: Date.now(),
        })
        updated += 1
      }
    }

    return { updated }
  },
})

// ---------------------------------------------------------------------------
// Worker functions for the integration-event Trigger task.
// ---------------------------------------------------------------------------

/** Everything the event worker needs before creating a run: the installation
 * (with settings), the run owner (email match falling back to the installer),
 * and the bridge state for the external thread when one exists. */
export const workerResolveEvent = query({
  args: {
    authorEmail: v.optional(v.string()),
    // Slack events do not always carry the team id; without it the single
    // installation of the provider is used (single-workspace mode).
    externalId: v.optional(v.string()),
    externalThreadId: v.optional(v.string()),
    provider: integrationProvider,
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const installation = args.externalId
      ? await installationForProviderExternal(
          ctx,
          args.provider,
          args.externalId
        )
      : await ctx.db
          .query("integrationInstallations")
          .withIndex("by_provider_external", (q) =>
            q.eq("provider", args.provider)
          )
          .first()
    if (!installation) return { status: "not_installed" as const }
    if (!installation.enabled) return { status: "disabled" as const }

    let ownerUserId = installation.userId
    const email = args.authorEmail?.trim().toLowerCase()
    if (email) {
      const matched = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first()
      if (matched) ownerUserId = matched._id
    }

    let bridge: {
      activeRun: boolean
      bridgeId: Id<"integrationThreads">
      muted: boolean
      pendingCount: number
      requiresCanonicalization: boolean
      threadId: Id<"threads">
      userId: Id<"users">
    } | null = null
    if (args.externalThreadId) {
      // Session identity is encoded in the canonical external thread ID so
      // callers never need a protocol-breaking validator change.
      const linearSession =
        args.provider === "linear"
          ? linearAgentSessionThreadParts(args.externalThreadId)
          : undefined
      const row = await bridgeForEvent(
        ctx,
        args.provider,
        args.externalThreadId,
        args.provider === "linear" ? args.externalId : undefined,
        linearSession?.agentSessionId
      )
      if (row) {
        const activeRun = await activeRunForThread(ctx, row.threadId)
        bridge = {
          activeRun: Boolean(activeRun),
          bridgeId: row._id,
          muted: Boolean(row.muted),
          pendingCount: row.pendingMessages?.length ?? 0,
          requiresCanonicalization:
            row.externalThreadId !== args.externalThreadId,
          threadId: row.threadId,
          userId: row.userId,
        }
      }
    }

    return {
      status: "ok" as const,
      bridge,
      defaultRepoUrl: installation.defaultRepoUrl,
      defaultSandboxPresetId: installation.defaultSandboxPresetId,
      externalId: installation.externalId,
      installationId: installation._id,
      ownerUserId,
    }
  },
})

/** Cheap pre-filter for the Slack webhook handler: does any enabled event
 * automation match this channel message or reaction? Only matching events
 * are enqueued to Trigger, so ordinary channel chatter costs one query and
 * nothing more. The event worker still claims and re-validates each fire. */
export const workerMatchSlackEvent = query({
  args: {
    channelId: v.string(),
    emoji: v.optional(v.string()),
    event: v.union(v.literal("keyword"), v.literal("reaction")),
    externalId: v.string(),
    text: v.optional(v.string()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const installation = await installationForProviderExternal(
      ctx,
      "slack",
      args.externalId
    )
    if (!installation || !installation.enabled) return []

    const rows = await ctx.db
      .query("automations")
      .withIndex("by_trigger_source", (q) =>
        q
          .eq("triggerSourceKey", `slack:${installation._id}:${args.event}`)
          .eq("enabled", true)
      )
      .take(50)

    const text = args.text?.toLowerCase() ?? ""
    return rows
      .filter((row) => {
        const trigger = row.trigger
        if (!trigger || trigger.kind !== "slack") return false
        if (trigger.channelId && trigger.channelId !== args.channelId) {
          return false
        }
        if (trigger.event === "keyword") {
          const keyword = trigger.keyword?.toLowerCase()
          return Boolean(keyword && text.includes(keyword))
        }
        return Boolean(trigger.emoji && trigger.emoji === args.emoji)
      })
      .map((row) => ({ automationId: row._id, name: row.name }))
  },
})

export const workerCreateSessionRun = mutation({
  args: {
    installationId: v.id("integrationInstallations"),
    externalThreadId: v.string(),
    linearAgentSessionId: v.optional(v.string()),
    linearIssueId: v.optional(v.string()),
    linearOrganizationId: v.optional(v.string()),
    prompt: v.string(),
    provider: integrationProvider,
    // Required for new sessions; follow-ups on an existing bridge continue
    // on the bridged thread's repository instead.
    repoUrl: v.optional(v.string()),
    // !preset=name override: matched case-insensitively against the owner's
    // preset names; "auto" forces the auto environment. New sessions only.
    sandboxPresetName: v.optional(v.string()),
    title: v.string(),
    userId: v.id("users"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const installation = await ctx.db.get(args.installationId)
    if (!installation || !installation.enabled) {
      return { ok: false as const, status: "not_installed" as const }
    }
    const prompt = args.prompt.trim()
    if (!prompt) return { ok: false as const, status: "empty_prompt" as const }

    const { auth, profile: authProfile } = await findCodexAuth(
      ctx,
      args.userId,
      undefined,
      { fallbackToActive: true }
    )
    if (!auth) {
      return {
        ok: false as const,
        message: codexAuthMissingMessage(authProfile),
        status: "missing_auth" as const,
      }
    }
    if (auth.invalidatedAt) {
      return {
        ok: false as const,
        message: codexAuthReconnectMessage(authProfile),
        status: "auth_reconnect_required" as const,
      }
    }

    const now = Date.now()
    const bridge = await bridgeForEvent(
      ctx,
      args.provider,
      args.externalThreadId,
      args.linearOrganizationId,
      args.linearAgentSessionId
    )

    // A mention on an already-bridged external thread continues its CloudCode
    // thread instead of opening a parallel session.
    if (bridge) {
      const canonicalIdentity = canonicalLinearBridgeIdentity(
        args.provider,
        args.externalThreadId,
        args.linearOrganizationId,
        args.linearAgentSessionId,
        bridge.externalThreadId
      )
      if (canonicalIdentity) {
        await ctx.db.patch(bridge._id, {
          ...canonicalIdentity,
          linearIssueId: args.linearIssueId,
          updatedAt: now,
        })
      }
      const thread = await ctx.db.get(bridge.threadId)
      if (!thread) return { ok: false as const, status: "not_found" as const }
      const activeRun = await activeRunForThread(ctx, bridge.threadId)
      if (activeRun) {
        return { ok: false as const, status: "thread_busy" as const }
      }

      const continuation = await threadContinuationInput(ctx, thread)
      const latest = continuation.latest
      const created = await insertFactoryRunRecords(ctx, {
        baseBranch: thread.baseBranch ?? latest?.baseBranch,
        branchMode: thread.branchMode ?? latest?.branchMode,
        branchName: latest?.branchName,
        codexThreadId: continuation.codexThreadId,
        logMessage: QUEUED_LOG_MESSAGE,
        model: latest?.model ?? thread.model,
        previousDiff: continuation.previousDiff,
        profile: auth.profile,
        prompt,
        reasoningEffort: latest?.reasoningEffort ?? INTEGRATION_RUN_EFFORT,
        repoUrl: latest?.repoUrl ?? thread.repoUrl,
        sandboxId: continuation.sandboxId,
        sandboxPresetId: latest?.sandboxPresetId ?? thread.sandboxPresetId,
        speed: latest?.speed ?? INTEGRATION_RUN_SPEED,
        threadId: thread._id,
        userId: bridge.userId,
      })
      await ctx.db.patch(bridge._id, {
        lastRunId: created.runId,
        muted: undefined,
        updatedAt: now,
      })
      return {
        ok: true as const,
        isFollowUp: true,
        repoUrl: latest?.repoUrl ?? thread.repoUrl,
        ...created,
      }
    }

    const rawRepoUrl = args.repoUrl?.trim()
    if (!rawRepoUrl) {
      return { ok: false as const, status: "missing_repo" as const }
    }
    // The canonical ".git" form is what app-created threads use; anything
    // else forks the per-repo environment cache into a parallel universe.
    const repoUrl = canonicalGitHubRepoUrl(rawRepoUrl) ?? rawRepoUrl

    let requestedPresetId = installation.defaultSandboxPresetId
    const requestedPresetName = args.sandboxPresetName?.trim().toLowerCase()
    if (requestedPresetName === "auto") {
      requestedPresetId = undefined
    } else if (requestedPresetName) {
      const presets = await ctx.db
        .query("sandboxPresets")
        .withIndex("by_user_updated", (q) => q.eq("userId", args.userId))
        .collect()
      const match = presets.find(
        (preset) => preset.name.trim().toLowerCase() === requestedPresetName
      )
      if (!match) {
        const names = presets
          .slice(0, 10)
          .map((preset) => `\`${preset.name}\``)
          .join(", ")
        return {
          ok: false as const,
          message: `No sandbox preset named "${args.sandboxPresetName}". Available: ${names ? `${names}, ` : ""}\`auto\`.`,
          status: "unknown_preset" as const,
        }
      }
      requestedPresetId = match._id
    }

    const sandboxPresetId = await resolveOwnedPresetOrAutoDefault(
      ctx,
      requestedPresetId,
      args.userId
    )
    const sessionModel = installation.defaultModel ?? INTEGRATION_RUN_MODEL
    const sessionEffort =
      installation.defaultReasoningEffort ?? INTEGRATION_RUN_EFFORT
    const baseBranch = installation.defaultBaseBranch?.trim() || undefined
    const threadId = await ctx.db.insert("threads", {
      ...(baseBranch ? { baseBranch } : {}),
      createdAt: now,
      model: sessionModel,
      repoUrl,
      sandboxPresetId,
      title: integrationThreadTitle(args.title),
      updatedAt: now,
      userId: args.userId,
    })
    const created = await insertFactoryRunRecords(ctx, {
      baseBranch,
      logMessage: QUEUED_LOG_MESSAGE,
      model: sessionModel,
      profile: auth.profile,
      prompt,
      reasoningEffort: sessionEffort,
      repoUrl,
      sandboxPresetId,
      speed: INTEGRATION_RUN_SPEED,
      threadId,
      userId: args.userId,
    })

    await ctx.db.insert("integrationThreads", {
      createdAt: now,
      externalThreadId: args.externalThreadId,
      installationId: installation._id,
      lastRunId: created.runId,
      linearAgentSessionId: args.linearAgentSessionId,
      linearIssueId: args.linearIssueId,
      linearOrganizationId: args.linearOrganizationId,
      provider: args.provider,
      threadId,
      updatedAt: now,
      userId: args.userId,
    })

    return { ok: true as const, isFollowUp: false, repoUrl, ...created }
  },
})

export const workerQueuePendingMessage = mutation({
  args: {
    authorName: v.string(),
    content: v.string(),
    externalThreadId: v.string(),
    provider: integrationProvider,
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const bridge = await bridgeForExternalThread(
      ctx,
      args.provider,
      args.externalThreadId
    )
    if (!bridge || bridge.muted) return { queued: false }

    const pending = [
      ...(bridge.pendingMessages ?? []),
      {
        authorName: args.authorName,
        content: args.content,
        receivedAt: Date.now(),
      },
    ].slice(-PENDING_MESSAGES_MAX)

    await ctx.db.patch(bridge._id, {
      pendingMessages: pending,
      updatedAt: Date.now(),
    })
    return { queued: true }
  },
})

export const workerRecordDeliveryFailure = mutation({
  args: {
    error: v.string(),
    externalThreadId: v.string(),
    provider: integrationProvider,
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const bridge = await bridgeForExternalThread(
      ctx,
      args.provider,
      args.externalThreadId
    )
    if (!bridge) return { recorded: false }

    await ctx.db.patch(bridge._id, {
      deliveryError: args.error.slice(0, 2000),
      deliveryErrorAt: Date.now(),
      updatedAt: Date.now(),
    })
    return { recorded: true }
  },
})

export const workerSetMuted = mutation({
  args: {
    externalThreadId: v.string(),
    muted: v.boolean(),
    provider: integrationProvider,
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const bridge = await bridgeForExternalThread(
      ctx,
      args.provider,
      args.externalThreadId
    )
    if (!bridge) return { updated: false }

    await ctx.db.patch(bridge._id, {
      muted: args.muted || undefined,
      updatedAt: Date.now(),
    })
    return { updated: true }
  },
})

/** Terminal-run context for outbound notifications: null when the run's
 * thread has no integration bridge, so the cloudcode-run seam is a no-op for
 * regular chat, automation, review, and factory runs. */
export const workerGetRunNotification = query({
  args: {
    runId: v.id("codexRuns"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const run = await ctx.db.get(args.runId)
    if (!run) return null
    const bridge = await ctx.db
      .query("integrationThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", run.threadId))
      .unique()
    if (!bridge) return null
    // The Slack workspace id lets OAuth-mode workers resolve the stored bot
    // token for the outbound post.
    const installation = await ctx.db.get(bridge.installationId)
    // The run's final response lives on its assistant message (workerComplete
    // finalizes it there); the run row's content field stays empty.
    const assistantMessage = await ctx.db.get(run.assistantMessageId)

    return {
      branchName: run.branchName,
      content: assistantMessage?.content || run.content,
      error: run.error,
      externalThreadId: bridge.externalThreadId,
      linearOrganizationId: bridge.linearOrganizationId,
      pendingCount: bridge.pendingMessages?.length ?? 0,
      provider: bridge.provider,
      prTitle: run.prTitle,
      prUrl: run.prUrl,
      repoUrl: run.repoUrl,
      slackTeamId:
        bridge.provider === "slack" ? installation?.externalId : undefined,
      status: run.status,
      threadId: run.threadId,
    }
  },
})

/** Drains queued follow-up messages into one continuation run once the
 * active run has finished. Returns the created run, or null when there is
 * nothing to drain or the thread is busy again. */
export const workerDrainPendingMessages = mutation({
  args: {
    threadId: v.id("threads"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    const bridge = await ctx.db
      .query("integrationThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .unique()
    if (!bridge || !bridge.pendingMessages?.length || bridge.muted) return null

    const thread = await ctx.db.get(bridge.threadId)
    if (!thread) return null
    const activeRun = await activeRunForThread(ctx, bridge.threadId)
    if (activeRun) return null

    const { auth } = await findCodexAuth(ctx, bridge.userId, undefined, {
      fallbackToActive: true,
    })
    if (!auth || auth.invalidatedAt) return null

    const prompt = bridge.pendingMessages
      .map((message) => `${message.authorName}: ${message.content}`)
      .join("\n\n")
    const continuation = await threadContinuationInput(ctx, thread)
    const latest = continuation.latest

    const created = await insertFactoryRunRecords(ctx, {
      baseBranch: thread.baseBranch ?? latest?.baseBranch,
      branchMode: thread.branchMode ?? latest?.branchMode,
      branchName: latest?.branchName,
      codexThreadId: continuation.codexThreadId,
      logMessage: QUEUED_LOG_MESSAGE,
      model: latest?.model ?? thread.model,
      previousDiff: continuation.previousDiff,
      profile: auth.profile,
      prompt,
      reasoningEffort: latest?.reasoningEffort ?? INTEGRATION_RUN_EFFORT,
      repoUrl: latest?.repoUrl ?? thread.repoUrl,
      sandboxId: continuation.sandboxId,
      sandboxPresetId: latest?.sandboxPresetId ?? thread.sandboxPresetId,
      speed: latest?.speed ?? INTEGRATION_RUN_SPEED,
      threadId: thread._id,
      userId: bridge.userId,
    })

    await ctx.db.patch(bridge._id, {
      lastRunId: created.runId,
      pendingMessages: undefined,
      updatedAt: Date.now(),
    })

    return { repoUrl: latest?.repoUrl ?? thread.repoUrl, ...created }
  },
})
