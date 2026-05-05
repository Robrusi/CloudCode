import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"

const TOOL_IDS = new Set([
  "auto-detect",
  "bun",
  "flutter",
  "node-pnpm",
  "python",
  "go",
  "rust",
  "uv",
  "conda",
  "ruby",
  "java",
  "kotlin",
  "dotnet",
  "elixir",
  "zig",
  "swift",
])

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const ENCRYPTED_SECRET_PREFIX = "cloudcode:v1:"
const DEFAULT_CPU_COUNT = 2
const DEFAULT_MEMORY_MB = 2048
const RESOURCE_PROFILES = [
  { cpuCount: 2, memoryMB: 2048 },
  { cpuCount: 4, memoryMB: 4096 },
  { cpuCount: 8, memoryMB: 8192 },
] as const
const DEFAULT_PRESETS = [
  {
    cpuCount: DEFAULT_CPU_COUNT,
    installScript: undefined,
    memoryMB: DEFAULT_MEMORY_MB,
    name: "Auto-detect",
    tools: ["auto-detect"],
  },
] as const

function cleanName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Preset name is required.")
  if (trimmed.length > 80) throw new Error("Preset name is too long.")
  return trimmed
}

function cleanInstallScript(script?: string) {
  const trimmed = script?.trim()
  if (!trimmed) return undefined
  if (trimmed.length > 20_000) throw new Error("Install script is too long.")
  return trimmed
}

function cleanTools(tools: string[]) {
  const unique = [...new Set(tools.map((tool) => tool.trim()).filter(Boolean))]
  if (unique.length > 20)
    throw new Error("A preset can include up to 20 tools.")
  for (const tool of unique) {
    if (!TOOL_IDS.has(tool)) throw new Error(`Unknown tool "${tool}".`)
  }
  return unique
}

function cleanResources(cpuCount?: number, memoryMB?: number) {
  const cleanedCpuCount = cpuCount ?? DEFAULT_CPU_COUNT
  const cleanedMemoryMB = memoryMB ?? DEFAULT_MEMORY_MB
  const valid = RESOURCE_PROFILES.some(
    (profile) =>
      profile.cpuCount === cleanedCpuCount &&
      profile.memoryMB === cleanedMemoryMB
  )

  if (!valid) {
    throw new Error("Sandbox size must be Normal, Large, or XLarge.")
  }

  return {
    cpuCount: cleanedCpuCount,
    memoryMB: cleanedMemoryMB,
  }
}

function storedResources(cpuCount?: number, memoryMB?: number) {
  try {
    return cleanResources(cpuCount, memoryMB)
  } catch {
    return {
      cpuCount: DEFAULT_CPU_COUNT,
      memoryMB: DEFAULT_MEMORY_MB,
    }
  }
}

function cleanEnvName(name: string) {
  const trimmed = name.trim()
  if (!ENV_NAME_RE.test(trimmed)) {
    throw new Error(
      "Secret names must start with a letter or underscore and contain only letters, numbers, and underscores."
    )
  }
  return trimmed
}

async function requireOwnedPreset(
  ctx: QueryCtx | MutationCtx,
  presetId: Id<"sandboxPresets">,
  userId: Id<"users">
) {
  const preset = await ctx.db.get(presetId)

  if (!preset || preset.userId !== userId) {
    throw new Error("Preset not found.")
  }

  return preset
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []

    const presets = await ctx.db
      .query("sandboxPresets")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect()

    return await Promise.all(
      presets.map(async (preset) => {
        const resources = storedResources(preset.cpuCount, preset.memoryMB)
        const secrets = await ctx.db
          .query("sandboxPresetSecrets")
          .withIndex("by_preset", (q) => q.eq("presetId", preset._id))
          .collect()

        return {
          cpuCount: resources.cpuCount,
          createdAt: preset.createdAt,
          id: preset._id,
          installScript: preset.installScript,
          memoryMB: resources.memoryMB,
          name: preset.name,
          secrets: secrets
            .map((secret) => ({
              hasValue: Boolean(secret.value),
              id: secret._id,
              name: secret.name,
              updatedAt: secret.updatedAt,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          tools: preset.tools,
          updatedAt: preset.updatedAt,
        }
      })
    )
  },
})

export const getForRun = query({
  args: {
    presetId: v.id("sandboxPresets"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    const preset = await requireOwnedPreset(ctx, args.presetId, user._id)
    const resources = storedResources(preset.cpuCount, preset.memoryMB)
    const secrets = await ctx.db
      .query("sandboxPresetSecrets")
      .withIndex("by_preset", (q) => q.eq("presetId", preset._id))
      .collect()

    return {
      cpuCount: resources.cpuCount,
      id: preset._id,
      installScript: preset.installScript,
      memoryMB: resources.memoryMB,
      name: preset.name,
      secrets: secrets
        .map((secret) => ({
          name: secret.name,
          value: secret.value,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      tools: preset.tools,
    }
  },
})

export const create = mutation({
  args: {
    cpuCount: v.optional(v.number()),
    installScript: v.optional(v.string()),
    memoryMB: v.optional(v.number()),
    name: v.string(),
    tools: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const now = Date.now()
    const resources = cleanResources(args.cpuCount, args.memoryMB)

    return await ctx.db.insert("sandboxPresets", {
      cpuCount: resources.cpuCount,
      createdAt: now,
      installScript: cleanInstallScript(args.installScript),
      memoryMB: resources.memoryMB,
      name: cleanName(args.name),
      tools: cleanTools(args.tools),
      updatedAt: now,
      userId,
    })
  },
})

export const ensureDefaultPresets = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await ensureCurrentUser(ctx)
    const now = Date.now()
    const ensuredIds: Id<"sandboxPresets">[] = []

    for (const preset of DEFAULT_PRESETS) {
      const existing = await ctx.db
        .query("sandboxPresets")
        .withIndex("by_user_updated", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("name"), preset.name))
        .first()

      if (existing) {
        ensuredIds.push(existing._id)
        continue
      }

      ensuredIds.push(
        await ctx.db.insert("sandboxPresets", {
          cpuCount: preset.cpuCount,
          createdAt: now,
          installScript: preset.installScript,
          memoryMB: preset.memoryMB,
          name: preset.name,
          tools: [...preset.tools],
          updatedAt: now,
          userId,
        })
      )
    }

    return ensuredIds
  },
})

export const update = mutation({
  args: {
    cpuCount: v.optional(v.number()),
    installScript: v.optional(v.string()),
    memoryMB: v.optional(v.number()),
    name: v.string(),
    presetId: v.id("sandboxPresets"),
    tools: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedPreset(ctx, args.presetId, userId)
    const resources = cleanResources(args.cpuCount, args.memoryMB)

    await ctx.db.patch(args.presetId, {
      cpuCount: resources.cpuCount,
      installScript: cleanInstallScript(args.installScript),
      memoryMB: resources.memoryMB,
      name: cleanName(args.name),
      tools: cleanTools(args.tools),
      updatedAt: Date.now(),
    })
  },
})

export const remove = mutation({
  args: {
    presetId: v.id("sandboxPresets"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedPreset(ctx, args.presetId, userId)

    const secrets = await ctx.db
      .query("sandboxPresetSecrets")
      .withIndex("by_preset", (q) => q.eq("presetId", args.presetId))
      .collect()

    for (const secret of secrets) {
      await ctx.db.delete(secret._id)
    }
    await ctx.db.delete(args.presetId)
  },
})

export const upsertSecret = mutation({
  args: {
    name: v.string(),
    presetId: v.id("sandboxPresets"),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedPreset(ctx, args.presetId, userId)

    const name = cleanEnvName(args.name)
    const value = args.value
    if (!value) throw new Error("Secret value is required.")
    if (value.length > 20_000) throw new Error("Secret value is too long.")
    if (!value.startsWith(ENCRYPTED_SECRET_PREFIX)) {
      throw new Error("Preset secrets must be saved through the server.")
    }

    const existing = await ctx.db
      .query("sandboxPresetSecrets")
      .withIndex("by_user_preset_name", (q) =>
        q.eq("userId", userId).eq("presetId", args.presetId).eq("name", name)
      )
      .unique()
    const now = Date.now()

    if (existing) {
      await ctx.db.patch(existing._id, {
        updatedAt: now,
        value,
      })
      return existing._id
    }

    return await ctx.db.insert("sandboxPresetSecrets", {
      createdAt: now,
      name,
      presetId: args.presetId,
      updatedAt: now,
      userId,
      value,
    })
  },
})

export const removeSecret = mutation({
  args: {
    secretId: v.id("sandboxPresetSecrets"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const secret = await ctx.db.get(args.secretId)

    if (!secret || secret.userId !== userId) {
      throw new Error("Secret not found.")
    }

    await ctx.db.delete(args.secretId)
  },
})
