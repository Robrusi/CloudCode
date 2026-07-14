import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import { runLog } from "./lib/codexRunValidators"
import {
  appendAutoEnvironmentBuildLogsToBuild,
  beginAutoEnvironmentBuildForUser,
  completeAutoEnvironmentBuildForBuild,
  failAutoEnvironmentBuildForBuild,
  requireBuildForWorker,
  requireOwnedBuild,
} from "./lib/sandboxPresetBuilds"
import {
  autoEnvironmentRunRow,
  isLegacyDefaultPreset,
  sandboxPresetListRow,
  sandboxPresetRunInput,
} from "./lib/sandboxPresetRecords"
import {
  ensureAutoEnvironmentPreset,
  ensureDefaultPreset,
  getAutoEnvironmentPreset,
  requireOwnedPreset,
} from "./lib/sandboxPresets"
import {
  isBuiltInAutoEnvironmentPreset,
  isBuiltInDefaultPreset,
} from "./lib/sandboxPresetConstants"
import {
  cleanDaytonaSnapshot,
  cleanEncryptedPresetSecretValue,
  cleanEnvName,
  cleanEnvironmentSlug,
  cleanInstallScript,
  cleanName,
} from "./lib/sandboxPresetValidation"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"

const ENVIRONMENT_LIST_LIMIT = 80

function presetListRank(preset: {
  isBuiltInAutoEnvironment?: boolean
  isBuiltInDefault?: boolean
}) {
  if (preset.isBuiltInAutoEnvironment) return 0
  if (preset.isBuiltInDefault) return 1
  return 2
}

function sortPresetRows<
  T extends {
    isBuiltInAutoEnvironment?: boolean
    isBuiltInDefault?: boolean
    name: string
    updatedAt: number
  },
>(rows: T[]) {
  return rows.toSorted((a, b) => {
    const rankDelta = presetListRank(a) - presetListRank(b)
    if (rankDelta !== 0) return rankDelta

    const updatedDelta = b.updatedAt - a.updatedAt
    if (updatedDelta !== 0) return updatedDelta

    return a.name.localeCompare(b.name)
  })
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

    const rows = await Promise.all(
      presets.map(async (preset) => {
        const secrets = await ctx.db
          .query("sandboxPresetSecrets")
          .withIndex("by_preset", (q) => q.eq("presetId", preset._id))
          .collect()

        if (isLegacyDefaultPreset(preset, secrets.length)) return null

        return sandboxPresetListRow({ preset, secrets })
      })
    )

    return sortPresetRows(rows.filter((row) => row !== null))
  },
})

export const listWithEnvironments = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []

    const [presets, environments, autoEnvironmentPreset] = await Promise.all([
      ctx.db
        .query("sandboxPresets")
        .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
        .order("desc")
        .collect(),
      ctx.db
        .query("sandboxPresetEnvironments")
        .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(ENVIRONMENT_LIST_LIMIT),
      getAutoEnvironmentPreset(ctx, user._id),
    ])

    const rows = await Promise.all(
      presets.map(async (preset) => {
        const secrets = await ctx.db
          .query("sandboxPresetSecrets")
          .withIndex("by_preset", (q) => q.eq("presetId", preset._id))
          .collect()

        if (isLegacyDefaultPreset(preset, secrets.length)) return null

        return sandboxPresetListRow({
          environmentPresetId: isBuiltInAutoEnvironmentPreset(preset)
            ? autoEnvironmentPreset?._id
            : undefined,
          environments,
          preset,
          secrets,
        })
      })
    )

    return sortPresetRows(rows.filter((row) => row !== null))
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
    const secrets = await ctx.db
      .query("sandboxPresetSecrets")
      .withIndex("by_preset", (q) => q.eq("presetId", preset._id))
      .collect()

    if (isLegacyDefaultPreset(preset, secrets.length)) return null

    return sandboxPresetRunInput(preset, secrets)
  },
})

export const create = mutation({
  args: {
    daytonaSnapshot: v.optional(v.string()),
    environmentSlug: v.optional(v.string()),
    installScript: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("manual"), v.literal("auto"))),
    name: v.string(),
    pathInstallScript: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const now = Date.now()
    const daytonaSnapshot = cleanDaytonaSnapshot(args.daytonaSnapshot)
    const environmentSlug = cleanEnvironmentSlug(args.environmentSlug)
    const installScript = cleanInstallScript(args.installScript)
    const mode = args.mode ?? "manual"
    const name = cleanName(args.name)
    const pathInstallScript = cleanInstallScript(args.pathInstallScript)

    if (isBuiltInDefaultPreset({ environmentSlug, mode, name })) {
      throw new Error("Default preset is built in.")
    }

    return await ctx.db.insert("sandboxPresets", {
      createdAt: now,
      daytonaSnapshot,
      environmentSlug,
      installScript,
      mode,
      name,
      pathInstallScript,
      updatedAt: now,
      userId,
    })
  },
})

export const ensureDefaultPresets = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await ensureCurrentUser(ctx)
    const defaultPresetId = await ensureDefaultPreset(ctx, userId)
    const autoPresetId = await ensureAutoEnvironmentPreset(ctx, userId)
    return [defaultPresetId, autoPresetId]
  },
})

export const update = mutation({
  args: {
    daytonaSnapshot: v.optional(v.string()),
    environmentSlug: v.optional(v.string()),
    installScript: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("manual"), v.literal("auto"))),
    name: v.string(),
    pathInstallScript: v.optional(v.string()),
    presetId: v.id("sandboxPresets"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const preset = await requireOwnedPreset(ctx, args.presetId, userId)
    if (isBuiltInDefaultPreset(preset)) {
      throw new Error("Default preset cannot be edited.")
    }

    const hasDaytonaSnapshot = Object.prototype.hasOwnProperty.call(
      args,
      "daytonaSnapshot"
    )
    const hasEnvironmentSlug = Object.prototype.hasOwnProperty.call(
      args,
      "environmentSlug"
    )
    const hasMode = Object.prototype.hasOwnProperty.call(args, "mode")
    const daytonaSnapshot = cleanDaytonaSnapshot(args.daytonaSnapshot)
    const environmentSlug = hasEnvironmentSlug
      ? cleanEnvironmentSlug(args.environmentSlug)
      : preset.environmentSlug
    const installScript = cleanInstallScript(args.installScript)
    const mode = hasMode ? (args.mode ?? "manual") : preset.mode
    const name = cleanName(args.name)
    const pathInstallScript = cleanInstallScript(args.pathInstallScript)

    if (isBuiltInDefaultPreset({ environmentSlug, mode, name })) {
      throw new Error("Default preset is built in.")
    }

    await ctx.db.patch(args.presetId, {
      autoSaveSnapshot: undefined,
      cpuCount: undefined,
      customToolingCommands: undefined,
      ...(hasDaytonaSnapshot ? { daytonaSnapshot } : {}),
      ...(hasEnvironmentSlug ? { environmentSlug } : {}),
      installScript,
      memoryMB: undefined,
      ...(hasMode ? { mode } : {}),
      name,
      pathInstallScript,
      toolVersions: undefined,
      tools: undefined,
      updatedAt: Date.now(),
    })
  },
})

export const getAutoEnvironmentForRun = query({
  args: {
    presetId: v.id("sandboxPresets"),
    repoUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    const preset = await requireOwnedPreset(ctx, args.presetId, user._id)
    if ((preset.mode ?? "manual") !== "auto") return null

    const autoEnvironmentPreset = await getAutoEnvironmentPreset(ctx, user._id)
    if (!autoEnvironmentPreset) return null

    const environment = await ctx.db
      .query("sandboxPresetEnvironments")
      .withIndex("by_preset_repo", (q) =>
        q
          .eq("userId", user._id)
          .eq("presetId", autoEnvironmentPreset._id)
          .eq("repoUrl", args.repoUrl)
      )
      .unique()

    if (!environment) return null

    return autoEnvironmentRunRow(environment)
  },
})

export const getAutoEnvironmentForRunForWorker = query({
  args: {
    presetId: v.id("sandboxPresets"),
    repoUrl: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const preset = await ctx.db.get(args.presetId)
    if (!preset || (preset.mode ?? "manual") !== "auto") return null

    const autoEnvironmentPreset = await getAutoEnvironmentPreset(
      ctx,
      preset.userId
    )
    if (!autoEnvironmentPreset) return null

    const environment = await ctx.db
      .query("sandboxPresetEnvironments")
      .withIndex("by_preset_repo", (q) =>
        q
          .eq("userId", preset.userId)
          .eq("presetId", autoEnvironmentPreset._id)
          .eq("repoUrl", args.repoUrl)
      )
      .unique()

    if (!environment) return null

    return autoEnvironmentRunRow(environment)
  },
})

export const beginAutoEnvironmentBuild = mutation({
  args: {
    baseBranch: v.optional(v.string()),
    presetId: v.id("sandboxPresets"),
    repoUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    return await beginAutoEnvironmentBuildForUser(ctx, args, userId)
  },
})

export const beginAutoEnvironmentBuildForWorker = mutation({
  args: {
    baseBranch: v.optional(v.string()),
    presetId: v.id("sandboxPresets"),
    repoUrl: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const preset = await ctx.db.get(args.presetId)
    if (!preset) throw new Error("Preset not found.")
    return await beginAutoEnvironmentBuildForUser(ctx, args, preset.userId)
  },
})

export const appendAutoEnvironmentBuildLogs = mutation({
  args: {
    buildId: v.id("sandboxPresetBuilds"),
    logs: v.array(runLog),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const build = await requireOwnedBuild(ctx, args.buildId, userId)
    await appendAutoEnvironmentBuildLogsToBuild(ctx, build, args.logs)
  },
})

export const appendAutoEnvironmentBuildLogsForWorker = mutation({
  args: {
    buildId: v.id("sandboxPresetBuilds"),
    logs: v.array(runLog),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const build = await requireBuildForWorker(ctx, args.buildId)
    await appendAutoEnvironmentBuildLogsToBuild(ctx, build, args.logs)
  },
})

export const completeAutoEnvironmentBuild = mutation({
  args: {
    buildId: v.id("sandboxPresetBuilds"),
    cloudcodeYaml: v.string(),
    configHash: v.string(),
    sandboxId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const build = await requireOwnedBuild(ctx, args.buildId, userId)
    await completeAutoEnvironmentBuildForBuild(ctx, build, args)
  },
})

export const completeAutoEnvironmentBuildForWorker = mutation({
  args: {
    buildId: v.id("sandboxPresetBuilds"),
    cloudcodeYaml: v.string(),
    configHash: v.string(),
    sandboxId: v.optional(v.string()),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const build = await requireBuildForWorker(ctx, args.buildId)
    await completeAutoEnvironmentBuildForBuild(ctx, build, args)
  },
})

export const failAutoEnvironmentBuild = mutation({
  args: {
    buildId: v.id("sandboxPresetBuilds"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const build = await requireOwnedBuild(ctx, args.buildId, userId)
    await failAutoEnvironmentBuildForBuild(ctx, build, args.error)
  },
})

export const failAutoEnvironmentBuildForWorker = mutation({
  args: {
    buildId: v.id("sandboxPresetBuilds"),
    error: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const build = await requireBuildForWorker(ctx, args.buildId)
    await failAutoEnvironmentBuildForBuild(ctx, build, args.error)
  },
})

export const remove = mutation({
  args: {
    presetId: v.id("sandboxPresets"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const preset = await requireOwnedPreset(ctx, args.presetId, userId)
    if (isBuiltInDefaultPreset(preset)) {
      throw new Error("Default preset cannot be deleted.")
    }
    if (isBuiltInAutoEnvironmentPreset(preset)) {
      throw new Error("Auto environment presets cannot be deleted.")
    }

    const secrets = await ctx.db
      .query("sandboxPresetSecrets")
      .withIndex("by_preset", (q) => q.eq("presetId", args.presetId))
      .collect()

    await Promise.all(secrets.map((secret) => ctx.db.delete(secret._id)))

    const environments = await ctx.db
      .query("sandboxPresetEnvironments")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .collect()

    await Promise.all(
      environments.flatMap((environment) =>
        environment.presetId === args.presetId
          ? [
              (async () => {
                const builds = await ctx.db
                  .query("sandboxPresetBuilds")
                  .withIndex("by_environment_updated", (q) =>
                    q.eq("environmentId", environment._id)
                  )
                  .collect()
                await Promise.all(
                  builds.map((build) => ctx.db.delete(build._id))
                )
                await ctx.db.delete(environment._id)
              })(),
            ]
          : []
      )
    )

    // Configuration records outlive user-created presets. Clear their
    // references in the same transaction so editors and future runs resolve
    // the user's built-in default instead of retaining a dangling ID.
    const [automations, reviews, threads] = await Promise.all([
      ctx.db
        .query("automations")
        .withIndex("by_user_preset", (q) =>
          q.eq("userId", userId).eq("sandboxPresetId", args.presetId)
        )
        .collect(),
      ctx.db
        .query("reviews")
        .withIndex("by_user_preset", (q) =>
          q.eq("userId", userId).eq("sandboxPresetId", args.presetId)
        )
        .collect(),
      ctx.db
        .query("threads")
        .withIndex("by_user_preset", (q) =>
          q.eq("userId", userId).eq("sandboxPresetId", args.presetId)
        )
        .collect(),
    ])
    await Promise.all([
      ...automations.map((automation) =>
        ctx.db.patch(automation._id, { sandboxPresetId: undefined })
      ),
      ...reviews.map((review) =>
        ctx.db.patch(review._id, { sandboxPresetId: undefined })
      ),
      ...threads.map((thread) =>
        ctx.db.patch(thread._id, { sandboxPresetId: undefined })
      ),
    ])

    await ctx.db.delete(args.presetId)
  },
})

export const removeEnvironment = mutation({
  args: {
    environmentId: v.id("sandboxPresetEnvironments"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const environment = await ctx.db.get(args.environmentId)
    if (!environment || environment.userId !== userId) {
      throw new Error("Environment not found.")
    }

    const builds = await ctx.db
      .query("sandboxPresetBuilds")
      .withIndex("by_environment_updated", (q) =>
        q.eq("environmentId", environment._id)
      )
      .collect()
    await Promise.all(builds.map((build) => ctx.db.delete(build._id)))
    await ctx.db.delete(environment._id)
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
    const preset = await requireOwnedPreset(ctx, args.presetId, userId)
    if (isBuiltInDefaultPreset(preset)) {
      throw new Error("Default preset cannot have secrets.")
    }

    const name = cleanEnvName(args.name)
    const value = cleanEncryptedPresetSecretValue(args.value)

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
    const [userId, secret] = await Promise.all([
      ensureCurrentUser(ctx),
      ctx.db.get(args.secretId),
    ])

    if (!secret || secret.userId !== userId) {
      throw new Error("Secret not found.")
    }

    await ctx.db.delete(secret._id)
  },
})
