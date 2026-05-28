import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const model = v.union(
  v.literal("gpt-5.5"),
  v.literal("gpt-5.4"),
  v.literal("gpt-5.4-mini")
)
const speed = v.union(v.literal("standard"), v.literal("fast"))
const branchMode = v.union(
  v.literal("auto"),
  v.literal("custom"),
  v.literal("base")
)
const thinking = v.union(
  v.literal("none"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("xhigh")
)
const sandboxState = v.union(
  v.literal("running"),
  v.literal("paused"),
  v.literal("killed"),
  v.literal("stopped"),
  v.literal("deleted"),
  v.literal("error")
)
const sandboxPresetMode = v.union(v.literal("manual"), v.literal("auto"))
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
const sandboxSnapshotStatus = v.union(
  v.literal("creating"),
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

const runLog = v.object({
  detail: v.optional(v.string()),
  kind: v.union(
    v.literal("setup"),
    v.literal("command"),
    v.literal("reasoning"),
    v.literal("stdout"),
    v.literal("stderr"),
    v.literal("result")
  ),
  message: v.string(),
  time: v.number(),
})

const messageMeta = v.object({
  branch: v.optional(v.string()),
  diff: v.optional(v.string()),
  logs: v.optional(v.array(runLog)),
  sandboxSnapshotId: v.optional(v.string()),
  status: v.optional(v.string()),
})

export default defineSchema({
  codexAuth: defineTable({
    accessToken: v.string(),
    accountId: v.union(v.string(), v.null()),
    authMode: v.literal("chatgpt"),
    fingerprint: v.string(),
    idToken: v.string(),
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
    logs: v.optional(v.array(runLog)),
    model,
    previousDiff: v.optional(v.string()),
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
    .index("by_user_updated", ["userId", "updatedAt"]),

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
    snapshotId: v.optional(v.id("sandboxSnapshots")),
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
    snapshotId: v.optional(v.id("sandboxSnapshots")),
    snapshotName: v.optional(v.string()),
    startedAt: v.number(),
    status: environmentBuildStatus,
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_environment_updated", ["environmentId", "updatedAt"])
    .index("by_user_updated", ["userId", "updatedAt"]),

  sandboxPresetEnvironments: defineTable({
    activeBuildId: v.optional(v.id("sandboxPresetBuilds")),
    activeSandboxId: v.optional(v.string()),
    activeSnapshot: v.optional(v.string()),
    activeSnapshotId: v.optional(v.id("sandboxSnapshots")),
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
    .index("by_preset_repo", ["userId", "presetId", "repoUrl"])
    .index("by_user_updated", ["userId", "updatedAt"]),

  sandboxSnapshots: defineTable({
    cloudcodeYaml: v.optional(v.string()),
    createdAt: v.number(),
    daytonaSnapshot: v.string(),
    error: v.optional(v.string()),
    name: v.string(),
    repoName: v.string(),
    repoUrl: v.string(),
    sourceBuildId: v.optional(v.id("sandboxPresetBuilds")),
    sourcePresetId: v.optional(v.id("sandboxPresets")),
    status: sandboxSnapshotStatus,
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_user_updated", ["userId", "updatedAt"])
    .index("by_user_repo_updated", ["userId", "repoUrl", "updatedAt"]),

  threads: defineTable({
    baseBranch: v.optional(v.string()),
    branchMode: v.optional(branchMode),
    codexThreadId: v.optional(v.string()),
    createdAt: v.number(),
    hasPendingMessage: v.optional(v.boolean()),
    lastUserMessageAt: v.optional(v.number()),
    model,
    repoUrl: v.string(),
    sandboxPresetId: v.optional(v.id("sandboxPresets")),
    sandboxSnapshotId: v.optional(v.string()),
    sandboxSnapshotIdsToDelete: v.optional(v.array(v.string())),
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
    createdAt: v.number(),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    name: v.optional(v.string()),
    subject: v.string(),
    tokenIdentifier: v.string(),
    updatedAt: v.number(),
  })
    .index("by_subject", ["subject"])
    .index("by_token", ["tokenIdentifier"]),
})
