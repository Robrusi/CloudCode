import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

import {
  branchMode,
  imageAttachment,
  messageMeta,
  model,
  runLog,
  speed,
  thinking,
  threadSandboxState as sandboxState,
} from "./lib/codexRunValidators"

const sandboxPresetMode = v.union(v.literal("manual"), v.literal("auto"))
const mcpTransport = v.union(v.literal("stdio"), v.literal("http"))
const mcpToolPolicy = v.union(
  v.literal("auto"),
  v.literal("prompt"),
  v.literal("never")
)
const mcpSecretKind = v.union(
  v.literal("env"),
  v.literal("httpHeader"),
  v.literal("envHttpHeader")
)
const environmentBuildStatus = v.union(
  v.literal("building"),
  v.literal("ready"),
  v.literal("failed")
)
const environmentStatus = v.union(
  v.literal("empty"),
  v.literal("building"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("stale")
)
const codexRunStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("canceling"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("canceled")
)
const billingPlanId = v.union(
  v.literal("free"),
  v.literal("hobby"),
  v.literal("plus")
)
const billingUsageSource = v.union(
  v.literal("trigger"),
  v.literal("daytona"),
  v.literal("reconciliation")
)
const billingUsageStatus = v.union(
  v.literal("pending"),
  v.literal("tracked"),
  v.literal("failed")
)
const daytonaBillingState = v.union(
  v.literal("running"),
  v.literal("stopped"),
  v.literal("archived"),
  v.literal("deleted"),
  v.literal("unknown")
)

export default defineSchema({
  codexAuth: defineTable({
    accessToken: v.string(),
    accountEmail: v.optional(v.string()),
    accountId: v.union(v.string(), v.null()),
    accountName: v.optional(v.string()),
    authMode: v.literal("chatgpt"),
    displayName: v.optional(v.string()),
    fingerprint: v.string(),
    idToken: v.string(),
    invalidReason: v.optional(v.string()),
    invalidatedAt: v.optional(v.string()),
    lastRefresh: v.string(),
    openaiApiKey: v.optional(v.string()),
    profile: v.string(),
    refreshToken: v.string(),
    updatedAt: v.string(),
    userId: v.id("users"),
  })
    .index("by_user_profile", ["userId", "profile"])
    .index("by_user_updated", ["userId", "updatedAt"]),

  codexRuns: defineTable({
    assistantMessageId: v.id("messages"),
    baseBranch: v.optional(v.string()),
    branchMode: v.optional(branchMode),
    branchName: v.optional(v.string()),
    codexThreadId: v.optional(v.string()),
    content: v.optional(v.string()),
    createdAt: v.number(),
    error: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
    githubToken: v.optional(v.string()),
    githubUserEmail: v.optional(v.string()),
    githubUserName: v.optional(v.string()),
    githubUsername: v.optional(v.string()),
    imageAttachments: v.optional(v.array(imageAttachment)),
    logs: v.optional(v.array(runLog)),
    model,
    previousDiff: v.optional(v.string()),
    notesAccessToken: v.optional(v.string()),
    profile: v.optional(v.string()),
    prompt: v.string(),
    reasoningEffort: thinking,
    repoUrl: v.string(),
    resumeContext: v.optional(v.string()),
    sandboxId: v.optional(v.string()),
    sandboxPresetId: v.optional(v.id("sandboxPresets")),
    sandboxState: v.optional(sandboxState),
    speed,
    startedAt: v.optional(v.number()),
    status: codexRunStatus,
    threadId: v.id("threads"),
    triggerRunId: v.optional(v.string()),
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_thread_updated", ["threadId", "updatedAt"])
    .index("by_sandbox", ["sandboxId"])
    .index("by_trigger_run", ["triggerRunId"])
    .index("by_user_profile_updated", ["userId", "profile", "updatedAt"])
    .index("by_user_updated", ["userId", "updatedAt"]),

  billingCustomers: defineTable({
    autumnCustomerId: v.string(),
    createdAt: v.number(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    planId: v.optional(billingPlanId),
    status: v.optional(v.string()),
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_autumn_customer", ["autumnCustomerId"])
    .index("by_user", ["userId"]),

  billingUsageEvents: defineTable({
    amountMicroUsd: v.number(),
    createdAt: v.number(),
    error: v.optional(v.string()),
    idempotencyKey: v.string(),
    metadata: v.optional(v.any()),
    resourceId: v.optional(v.string()),
    source: billingUsageSource,
    status: billingUsageStatus,
    trackedAt: v.optional(v.number()),
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_resource_source", ["resourceId", "source"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_status", ["userId", "status"]),

  billingSandboxSegments: defineTable({
    active: v.boolean(),
    amountMicroUsd: v.optional(v.number()),
    cpu: v.number(),
    diskGiB: v.number(),
    endedAt: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
    lastObservedAt: v.number(),
    memoryGiB: v.number(),
    rateVersion: v.string(),
    sandboxId: v.string(),
    source: v.union(v.literal("observed"), v.literal("webhook")),
    startedAt: v.number(),
    state: daytonaBillingState,
    usageEventId: v.optional(v.id("billingUsageEvents")),
    userId: v.id("users"),
  })
    .index("by_sandbox_active", ["sandboxId", "active"])
    .index("by_sandbox_started", ["sandboxId", "startedAt"])
    .index("by_active", ["active"])
    .index("by_user_active", ["userId", "active"])
    .index("by_user_started", ["userId", "startedAt"]),

  sshAccessTokens: defineTable({
    accessId: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    label: v.string(),
    sandboxId: v.string(),
    sshCommand: v.string(),
    token: v.string(),
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_sandbox", ["sandboxId"])
    .index("by_user_sandbox", ["userId", "sandboxId"]),

  githubAppInstallations: defineTable({
    accountId: v.optional(v.string()),
    accountLogin: v.string(),
    accountType: v.optional(v.string()),
    htmlUrl: v.optional(v.string()),
    installationId: v.string(),
    repositorySelection: v.optional(v.string()),
    updatedAt: v.string(),
    userId: v.id("users"),
  })
    .index("by_user", ["userId"])
    .index("by_user_installation", ["userId", "installationId"]),

  githubAppUsers: defineTable({
    email: v.optional(v.string()),
    encryptedRefreshToken: v.optional(v.string()),
    encryptedToken: v.string(),
    expiresAt: v.optional(v.string()),
    fingerprint: v.string(),
    githubUserId: v.string(),
    login: v.string(),
    name: v.optional(v.string()),
    refreshTokenExpiresAt: v.optional(v.string()),
    updatedAt: v.string(),
    userId: v.id("users"),
  })
    .index("by_user", ["userId"])
    .index("by_github_user", ["githubUserId"]),

  messages: defineTable({
    attachments: v.optional(v.array(imageAttachment)),
    content: v.string(),
    error: v.optional(v.boolean()),
    meta: v.optional(messageMeta),
    pending: v.optional(v.boolean()),
    role: v.union(v.literal("user"), v.literal("assistant")),
    speed: v.optional(speed),
    thinking: v.optional(thinking),
    threadId: v.id("threads"),
    userId: v.id("users"),
  }).index("by_thread", ["threadId"]),

  sandboxPresetSecrets: defineTable({
    createdAt: v.number(),
    name: v.string(),
    presetId: v.id("sandboxPresets"),
    updatedAt: v.number(),
    userId: v.id("users"),
    value: v.string(),
  })
    .index("by_preset", ["presetId"])
    .index("by_user_preset_name", ["userId", "presetId", "name"]),

  sandboxPresets: defineTable({
    autoSaveSnapshot: v.optional(v.boolean()),
    cpuCount: v.optional(v.number()),
    createdAt: v.number(),
    customToolingCommands: v.optional(v.array(v.string())),
    daytonaSnapshot: v.optional(v.string()),
    environmentSlug: v.optional(v.string()),
    installScript: v.optional(v.string()),
    memoryMB: v.optional(v.number()),
    mode: v.optional(sandboxPresetMode),
    name: v.string(),
    pathInstallScript: v.optional(v.string()),
    toolVersions: v.optional(
      v.array(
        v.object({
          tool: v.string(),
          version: v.string(),
        })
      )
    ),
    tools: v.optional(v.array(v.string())),
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_user_updated", ["userId", "updatedAt"])
    .index("by_user_mode", ["userId", "mode"]),

  mcpServers: defineTable({
    args: v.optional(v.array(v.string())),
    bearerTokenEnvVar: v.optional(v.string()),
    command: v.optional(v.string()),
    createdAt: v.number(),
    cwd: v.optional(v.string()),
    description: v.optional(v.string()),
    enabled: v.boolean(),
    envVars: v.optional(v.array(v.string())),
    name: v.string(),
    serverName: v.string(),
    startupTimeoutSec: v.optional(v.number()),
    toolTimeoutSec: v.optional(v.number()),
    transport: mcpTransport,
    updatedAt: v.number(),
    url: v.optional(v.string()),
    userId: v.id("users"),
  })
    .index("by_user_updated", ["userId", "updatedAt"])
    .index("by_user_server_name", ["userId", "serverName"]),

  mcpServerSecrets: defineTable({
    createdAt: v.number(),
    kind: mcpSecretKind,
    name: v.string(),
    serverId: v.id("mcpServers"),
    updatedAt: v.number(),
    userId: v.id("users"),
    value: v.string(),
  })
    .index("by_server", ["serverId"])
    .index("by_user_server_name", ["userId", "serverId", "name"]),

  mcpServerTools: defineTable({
    annotations: v.optional(v.string()),
    createdAt: v.number(),
    description: v.optional(v.string()),
    name: v.string(),
    policy: mcpToolPolicy,
    serverId: v.id("mcpServers"),
    title: v.optional(v.string()),
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_server", ["serverId"])
    .index("by_user_server_name", ["userId", "serverId", "name"]),

  sandboxPresetBuilds: defineTable({
    buildNumber: v.number(),
    cloudcodeYaml: v.optional(v.string()),
    configHash: v.optional(v.string()),
    createdAt: v.number(),
    environmentId: v.id("sandboxPresetEnvironments"),
    error: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
    logs: v.optional(v.array(runLog)),
    presetId: v.id("sandboxPresets"),
    repoUrl: v.string(),
    sandboxId: v.optional(v.string()),
    startedAt: v.number(),
    status: environmentBuildStatus,
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_environment_updated", ["environmentId", "updatedAt"])
    .index("by_sandbox_user", ["sandboxId", "userId"])
    .index("by_user_updated", ["userId", "updatedAt"]),

  sandboxPresetEnvironments: defineTable({
    activeBuildId: v.optional(v.id("sandboxPresetBuilds")),
    activeSandboxId: v.optional(v.string()),
    activeSnapshot: v.optional(v.string()),
    baseBranch: v.optional(v.string()),
    buildNumber: v.number(),
    builtAt: v.optional(v.number()),
    cloudcodeYaml: v.optional(v.string()),
    configHash: v.optional(v.string()),
    createdAt: v.number(),
    environmentSlug: v.string(),
    lastError: v.optional(v.string()),
    presetId: v.id("sandboxPresets"),
    repoUrl: v.string(),
    status: environmentStatus,
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_active_sandbox_user", ["activeSandboxId", "userId"])
    .index("by_preset_repo", ["userId", "presetId", "repoUrl"])
    .index("by_user_updated", ["userId", "updatedAt"]),

  threads: defineTable({
    baseBranch: v.optional(v.string()),
    branchMode: v.optional(branchMode),
    codexThreadId: v.optional(v.string()),
    createdAt: v.number(),
    hasPendingMessage: v.optional(v.boolean()),
    lastUserMessageAt: v.optional(v.number()),
    model,
    notes: v.optional(v.string()),
    repoUrl: v.string(),
    sandboxPresetId: v.optional(v.id("sandboxPresets")),
    sandboxId: v.optional(v.string()),
    sandboxState: v.optional(sandboxState),
    title: v.string(),
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_user_updated", ["userId", "updatedAt"])
    .index("by_sandbox", ["sandboxId"])
    .index("by_user_repo_updated", ["userId", "repoUrl", "updatedAt"]),

  users: defineTable({
    activeCodexProfile: v.optional(v.string()),
    createdAt: v.number(),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    name: v.optional(v.string()),
    onboardingDismissedAt: v.optional(v.number()),
    subject: v.string(),
    tokenIdentifier: v.string(),
    updatedAt: v.number(),
  })
    .index("by_subject", ["subject"])
    .index("by_token", ["tokenIdentifier"]),
})
