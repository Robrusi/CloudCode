import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const model = v.union(
  v.literal("gpt-5.5"),
  v.literal("gpt-5.4"),
  v.literal("gpt-5.4-mini")
)
const speed = v.union(v.literal("standard"), v.literal("fast"))
const thinking = v.union(
  v.literal("none"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("xhigh")
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
    createdAt: v.number(),
    installScript: v.optional(v.string()),
    name: v.string(),
    tools: v.array(v.string()),
    updatedAt: v.number(),
    userId: v.id("users"),
  }).index("by_user_updated", ["userId", "updatedAt"]),

  threads: defineTable({
    codexThreadId: v.optional(v.string()),
    createdAt: v.number(),
    model,
    repoUrl: v.string(),
    sandboxPresetId: v.optional(v.id("sandboxPresets")),
    sandboxId: v.optional(v.string()),
    sandboxSnapshotId: v.optional(v.string()),
    sandboxSnapshotIdsToDelete: v.optional(v.array(v.string())),
    title: v.string(),
    updatedAt: v.number(),
    userId: v.id("users"),
  })
    .index("by_user_updated", ["userId", "updatedAt"])
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
