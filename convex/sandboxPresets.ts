import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const ENCRYPTED_SECRET_PREFIX = "cloudcode:v1:"
const ENVIRONMENT_LIST_LIMIT = 80
const MAX_STORED_BUILD_LOGS = 120
const MAX_STORED_LOG_MESSAGE_LENGTH = 500
const MAX_STORED_LOG_DETAIL_LENGTH = 1_500
const STORED_LOG_KINDS = new Set<string>([
  "setup",
  "command",
  "result",
  "stderr",
])

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

type StoredRunLog = {
  detail?: string
  kind: "setup" | "command" | "reasoning" | "stdout" | "stderr" | "result"
  message: string
  time: number
}

function truncate(value: string | undefined, max: number) {
  if (!value) return undefined
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function compactRunLog(log: StoredRunLog) {
  if (!STORED_LOG_KINDS.has(log.kind)) return null
  return {
    ...(truncate(log.detail, MAX_STORED_LOG_DETAIL_LENGTH)
      ? { detail: truncate(log.detail, MAX_STORED_LOG_DETAIL_LENGTH) }
      : {}),
    kind: log.kind,
    message: truncate(log.message, MAX_STORED_LOG_MESSAGE_LENGTH) ?? "",
    time: log.time,
  }
}

function cleanName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Preset name is required.")
  if (trimmed.length > 80) throw new Error("Preset name is too long.")
  return trimmed
}

function cleanDaytonaSnapshot(snapshot?: string) {
  const trimmed = snapshot?.trim()
  if (!trimmed) return undefined
  if (trimmed.length > 160) throw new Error("Snapshot name is too long.")
  if (!/^[A-Za-z0-9._:/-]+$/.test(trimmed)) {
    throw new Error(
      "Snapshot names can only contain letters, numbers, dots, dashes, underscores, slashes, and colons."
    )
  }
  return trimmed
}

function slugify(value: string, fallback = "environment") {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)

  return slug || fallback
}

function repoSlug(repoUrl: string) {
  const cleaned = repoUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
  const parts = cleaned.split("/")
  return slugify(parts.at(-1) || cleaned, "repo")
}

function cleanEnvironmentSlug(slug?: string) {
  return slug ? slugify(slug) : undefined
}

function cleanInstallScript(script?: string) {
  const normalized = script?.replace(/\r\n/g, "\n").trim()
  if (!normalized) return undefined
  if (normalized.length > 20_000) throw new Error("Install script is too long.")
  return normalized
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

function isLegacyDefaultPreset(
  preset: {
    daytonaSnapshot?: string
    installScript?: string
    name: string
    pathInstallScript?: string
  },
  secretCount: number
) {
  return (
    preset.name === "Default Daytona" &&
    !preset.daytonaSnapshot &&
    !preset.installScript &&
    !preset.pathInstallScript &&
    secretCount === 0
  )
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

        return {
          createdAt: preset.createdAt,
          daytonaSnapshot: preset.daytonaSnapshot,
          environmentSlug: preset.environmentSlug,
          id: preset._id,
          installScript: preset.installScript,
          mode: preset.mode ?? "manual",
          name: preset.name,
          pathInstallScript: preset.pathInstallScript,
          secrets: secrets
            .map((secret) => ({
              hasValue: Boolean(secret.value),
              id: secret._id,
              name: secret.name,
              updatedAt: secret.updatedAt,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          updatedAt: preset.updatedAt,
        }
      })
    )

    return rows.filter((row) => row !== null)
  },
})

export const listWithEnvironments = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []

    const presets = await ctx.db
      .query("sandboxPresets")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect()

    const environments = await ctx.db
      .query("sandboxPresetEnvironments")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(ENVIRONMENT_LIST_LIMIT)

    const rows = await Promise.all(
      presets.map(async (preset) => {
        const secrets = await ctx.db
          .query("sandboxPresetSecrets")
          .withIndex("by_preset", (q) => q.eq("presetId", preset._id))
          .collect()

        if (isLegacyDefaultPreset(preset, secrets.length)) return null

        return {
          createdAt: preset.createdAt,
          daytonaSnapshot: preset.daytonaSnapshot,
          environmentSlug: preset.environmentSlug,
          id: preset._id,
          installScript: preset.installScript,
          mode: preset.mode ?? "manual",
          name: preset.name,
          pathInstallScript: preset.pathInstallScript,
          environments: environments
            .filter((environment) => environment.presetId === preset._id)
            .slice(0, 8)
            .map((environment) => ({
              activeSandboxId: environment.activeSandboxId,
              builtAt: environment.builtAt,
              environmentSlug: environment.environmentSlug,
              id: environment._id,
              repoUrl: environment.repoUrl,
              status: environment.status,
              updatedAt: environment.updatedAt,
            })),
          secrets: secrets
            .map((secret) => ({
              hasValue: Boolean(secret.value),
              id: secret._id,
              name: secret.name,
              updatedAt: secret.updatedAt,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          updatedAt: preset.updatedAt,
        }
      })
    )

    return rows.filter((row) => row !== null)
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

    return {
      daytonaSnapshot: preset.daytonaSnapshot,
      environmentSlug: preset.environmentSlug,
      id: preset._id,
      installScript: preset.installScript,
      mode: preset.mode ?? "manual",
      name: preset.name,
      pathInstallScript: preset.pathInstallScript,
      secrets: secrets
        .map((secret) => ({
          name: secret.name,
          value: secret.value,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
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

    return await ctx.db.insert("sandboxPresets", {
      createdAt: now,
      daytonaSnapshot: cleanDaytonaSnapshot(args.daytonaSnapshot),
      environmentSlug: cleanEnvironmentSlug(args.environmentSlug),
      installScript: cleanInstallScript(args.installScript),
      mode: args.mode ?? "manual",
      name: cleanName(args.name),
      pathInstallScript: cleanInstallScript(args.pathInstallScript),
      updatedAt: now,
      userId,
    })
  },
})

export const ensureDefaultPresets = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await ensureCurrentUser(ctx)
    const existing = await ctx.db
      .query("sandboxPresets")
      .withIndex("by_user_mode", (q) =>
        q.eq("userId", userId).eq("mode", "auto")
      )
      .first()

    if (existing) return [existing._id]

    const now = Date.now()
    const id = await ctx.db.insert("sandboxPresets", {
      createdAt: now,
      environmentSlug: "auto",
      mode: "auto",
      name: "Auto environment",
      updatedAt: now,
      userId,
    })

    return [id]
  },
})

export const update = mutation({
  args: {
    daytonaSnapshot: v.optional(v.string()),
    environmentSlug: v.optional(v.string()),
    installScript: v.optional(v.string()),
    name: v.string(),
    pathInstallScript: v.optional(v.string()),
    presetId: v.id("sandboxPresets"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireOwnedPreset(ctx, args.presetId, userId)

    await ctx.db.patch(args.presetId, {
      autoSaveSnapshot: undefined,
      cpuCount: undefined,
      customToolingCommands: undefined,
      ...(Object.prototype.hasOwnProperty.call(args, "daytonaSnapshot")
        ? { daytonaSnapshot: cleanDaytonaSnapshot(args.daytonaSnapshot) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(args, "environmentSlug")
        ? { environmentSlug: cleanEnvironmentSlug(args.environmentSlug) }
        : {}),
      installScript: cleanInstallScript(args.installScript),
      memoryMB: undefined,
      name: cleanName(args.name),
      pathInstallScript: cleanInstallScript(args.pathInstallScript),
      snapshotId: undefined,
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

    const environment = await ctx.db
      .query("sandboxPresetEnvironments")
      .withIndex("by_preset_repo", (q) =>
        q
          .eq("userId", user._id)
          .eq("presetId", preset._id)
          .eq("repoUrl", args.repoUrl)
      )
      .unique()

    if (!environment) return null

    return {
      activeSandboxId: environment.activeSandboxId,
      buildNumber: environment.buildNumber,
      builtAt: environment.builtAt,
      cloudcodeYaml: environment.cloudcodeYaml,
      configHash: environment.configHash,
      environmentSlug: environment.environmentSlug,
      id: environment._id,
      lastError: environment.lastError,
      repoUrl: environment.repoUrl,
      status: environment.status,
      updatedAt: environment.updatedAt,
    }
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

    const environment = await ctx.db
      .query("sandboxPresetEnvironments")
      .withIndex("by_preset_repo", (q) =>
        q
          .eq("userId", preset.userId)
          .eq("presetId", preset._id)
          .eq("repoUrl", args.repoUrl)
      )
      .unique()

    if (!environment) return null

    return {
      activeSandboxId: environment.activeSandboxId,
      buildNumber: environment.buildNumber,
      builtAt: environment.builtAt,
      cloudcodeYaml: environment.cloudcodeYaml,
      configHash: environment.configHash,
      environmentSlug: environment.environmentSlug,
      id: environment._id,
      lastError: environment.lastError,
      repoUrl: environment.repoUrl,
      status: environment.status,
      updatedAt: environment.updatedAt,
    }
  },
})

async function beginAutoEnvironmentBuildForUser(
  ctx: MutationCtx,
  args: {
    baseBranch?: string
    presetId: Id<"sandboxPresets">
    repoUrl: string
  },
  userId: Id<"users">
) {
  const preset = await requireOwnedPreset(ctx, args.presetId, userId)
  if ((preset.mode ?? "manual") !== "auto") {
    throw new Error("Preset is not an auto environment preset.")
  }

  const repoUrl = args.repoUrl.trim()
  if (!repoUrl) throw new Error("repoUrl is required.")

  const now = Date.now()
  let environment = await ctx.db
    .query("sandboxPresetEnvironments")
    .withIndex("by_preset_repo", (q) =>
      q
        .eq("userId", userId)
        .eq("presetId", args.presetId)
        .eq("repoUrl", repoUrl)
    )
    .unique()

  const environmentSlug = slugify(
    [
      preset.environmentSlug && preset.environmentSlug !== "auto"
        ? preset.environmentSlug
        : preset.name,
      repoSlug(repoUrl),
    ]
      .filter(Boolean)
      .join("-")
  )
  const buildNumber = (environment?.buildNumber ?? 0) + 1

  if (!environment) {
    const environmentId = await ctx.db.insert("sandboxPresetEnvironments", {
      ...(args.baseBranch?.trim()
        ? { baseBranch: args.baseBranch.trim() }
        : {}),
      buildNumber,
      createdAt: now,
      environmentSlug,
      presetId: args.presetId,
      repoUrl,
      status: "building",
      updatedAt: now,
      userId,
    })
    environment = (await ctx.db.get(environmentId))!
  } else {
    await ctx.db.patch(environment._id, {
      ...(args.baseBranch?.trim()
        ? { baseBranch: args.baseBranch.trim() }
        : {}),
      buildNumber,
      environmentSlug,
      lastError: undefined,
      status: "building",
      updatedAt: now,
    })
  }

  const buildId = await ctx.db.insert("sandboxPresetBuilds", {
    buildNumber,
    createdAt: now,
    environmentId: environment._id,
    logs: [],
    presetId: args.presetId,
    repoUrl,
    startedAt: now,
    status: "building",
    updatedAt: now,
    userId,
  })
  await ctx.db.patch(environment._id, {
    activeBuildId: buildId,
    activeSandboxId: undefined,
    activeSnapshot: undefined,
    activeSnapshotId: undefined,
    updatedAt: now,
  })

  return {
    buildId,
    buildNumber,
    environmentId: environment._id,
    environmentSlug,
  }
}

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

async function requireOwnedBuild(
  ctx: MutationCtx,
  buildId: Id<"sandboxPresetBuilds">,
  userId: Id<"users">
) {
  const build = await ctx.db.get(buildId)
  if (!build || build.userId !== userId) {
    throw new Error("Environment build not found.")
  }
  return build
}

async function requireBuildForWorker(
  ctx: MutationCtx,
  buildId: Id<"sandboxPresetBuilds">
) {
  const build = await ctx.db.get(buildId)
  if (!build) {
    throw new Error("Environment build not found.")
  }
  return build
}

export const appendAutoEnvironmentBuildLogs = mutation({
  args: {
    buildId: v.id("sandboxPresetBuilds"),
    logs: v.array(runLog),
  },
  handler: async (ctx, args) => {
    if (args.logs.length === 0) return
    const userId = await ensureCurrentUser(ctx)
    const build = await requireOwnedBuild(ctx, args.buildId, userId)

    const logs = args.logs.flatMap((log) => {
      const compacted = compactRunLog(log)
      return compacted ? [compacted] : []
    })
    if (logs.length === 0) return

    await ctx.db.patch(args.buildId, {
      logs: [...(build.logs ?? []), ...logs].slice(-MAX_STORED_BUILD_LOGS),
      updatedAt: Date.now(),
    })
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
    if (args.logs.length === 0) return
    const build = await requireBuildForWorker(ctx, args.buildId)

    const logs = args.logs.flatMap((log) => {
      const compacted = compactRunLog(log)
      return compacted ? [compacted] : []
    })
    if (logs.length === 0) return

    await ctx.db.patch(args.buildId, {
      logs: [...(build.logs ?? []), ...logs].slice(-MAX_STORED_BUILD_LOGS),
      updatedAt: Date.now(),
    })
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
    const now = Date.now()

    await ctx.db.patch(args.buildId, {
      cloudcodeYaml: args.cloudcodeYaml,
      configHash: args.configHash,
      finishedAt: now,
      sandboxId: args.sandboxId,
      snapshotId: undefined,
      snapshotName: undefined,
      status: "ready",
      updatedAt: now,
    })
    await ctx.db.patch(build.environmentId, {
      activeBuildId: args.buildId,
      activeSandboxId: args.sandboxId,
      activeSnapshot: undefined,
      activeSnapshotId: undefined,
      builtAt: now,
      cloudcodeYaml: args.cloudcodeYaml,
      configHash: args.configHash,
      lastError: undefined,
      status: "ready",
      updatedAt: now,
    })
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
    const now = Date.now()

    await ctx.db.patch(args.buildId, {
      cloudcodeYaml: args.cloudcodeYaml,
      configHash: args.configHash,
      finishedAt: now,
      sandboxId: args.sandboxId,
      snapshotId: undefined,
      snapshotName: undefined,
      status: "ready",
      updatedAt: now,
    })
    await ctx.db.patch(build.environmentId, {
      activeBuildId: args.buildId,
      activeSandboxId: args.sandboxId,
      activeSnapshot: undefined,
      activeSnapshotId: undefined,
      builtAt: now,
      cloudcodeYaml: args.cloudcodeYaml,
      configHash: args.configHash,
      lastError: undefined,
      status: "ready",
      updatedAt: now,
    })
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
    const now = Date.now()

    await ctx.db.patch(args.buildId, {
      error: args.error,
      finishedAt: now,
      status: "failed",
      updatedAt: now,
    })
    await ctx.db.patch(build.environmentId, {
      lastError: args.error,
      status: "failed",
      updatedAt: now,
    })
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
    const now = Date.now()

    await ctx.db.patch(args.buildId, {
      error: args.error,
      finishedAt: now,
      status: "failed",
      updatedAt: now,
    })
    await ctx.db.patch(build.environmentId, {
      lastError: args.error,
      status: "failed",
      updatedAt: now,
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

    const environments = await ctx.db
      .query("sandboxPresetEnvironments")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .collect()

    for (const environment of environments) {
      if (environment.presetId !== args.presetId) continue
      const builds = await ctx.db
        .query("sandboxPresetBuilds")
        .withIndex("by_environment_updated", (q) =>
          q.eq("environmentId", environment._id)
        )
        .collect()
      for (const build of builds) {
        await ctx.db.delete(build._id)
      }
      await ctx.db.delete(environment._id)
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

    await ctx.db.delete(secret._id)
  },
})
