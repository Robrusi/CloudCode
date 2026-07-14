import type { Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import {
  AUTO_ENVIRONMENT_PRESET,
  DEFAULT_PRESET,
  isBuiltInAutoEnvironmentPreset,
  isBuiltInDefaultPreset,
} from "./sandboxPresetConstants"
import { throwUserError } from "./userErrors"

export async function getDefaultPreset(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  const defaultPresets = await ctx.db
    .query("sandboxPresets")
    .withIndex("by_user_updated", (q) => q.eq("userId", userId))
    .collect()

  return defaultPresets.find(isBuiltInDefaultPreset) ?? null
}

export async function getAutoEnvironmentPreset(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  const autoPresets = await ctx.db
    .query("sandboxPresets")
    .withIndex("by_user_mode", (q) =>
      q.eq("userId", userId).eq("mode", AUTO_ENVIRONMENT_PRESET.mode)
    )
    .collect()

  return autoPresets.find(isBuiltInAutoEnvironmentPreset) ?? null
}

async function clearDefaultPresetOptions(
  ctx: MutationCtx,
  presetId: Id<"sandboxPresets">
) {
  const secrets = await ctx.db
    .query("sandboxPresetSecrets")
    .withIndex("by_preset", (q) => q.eq("presetId", presetId))
    .collect()

  await Promise.all(secrets.map((secret) => ctx.db.delete(secret._id)))
}

export async function ensureDefaultPreset(
  ctx: MutationCtx,
  userId: Id<"users">
) {
  const existing = await getDefaultPreset(ctx, userId)

  if (existing) {
    await clearDefaultPresetOptions(ctx, existing._id)
    if (
      existing.daytonaSnapshot ||
      existing.installScript ||
      existing.pathInstallScript
    ) {
      await ctx.db.patch(existing._id, {
        daytonaSnapshot: undefined,
        installScript: undefined,
        pathInstallScript: undefined,
        updatedAt: Date.now(),
      })
    }
    return existing._id
  }

  const now = Date.now()
  return await ctx.db.insert("sandboxPresets", {
    ...DEFAULT_PRESET,
    createdAt: now,
    updatedAt: now,
    userId,
  })
}

export async function ensureAutoEnvironmentPreset(
  ctx: MutationCtx,
  userId: Id<"users">
) {
  const existing = await getAutoEnvironmentPreset(ctx, userId)

  if (existing) return existing._id

  const now = Date.now()
  return await ctx.db.insert("sandboxPresets", {
    ...AUTO_ENVIRONMENT_PRESET,
    createdAt: now,
    updatedAt: now,
    userId,
  })
}

export async function resolveOwnedPresetOrAutoDefault(
  ctx: MutationCtx,
  presetId: Id<"sandboxPresets"> | undefined,
  userId: Id<"users">,
  options?: { autoEnvironment?: boolean }
) {
  if (!presetId) {
    const defaultPresetId = await ensureDefaultPreset(ctx, userId)
    // Callers can opt out of auto environment setup (automations expose this
    // as a toggle); those run in the plain built-in default sandbox.
    if (options?.autoEnvironment === false) return defaultPresetId
    return await ensureAutoEnvironmentPreset(ctx, userId)
  }

  const preset = await ctx.db.get(presetId)
  // Presets can disappear while a long-lived automation, review, or thread
  // still carries the old ID (for example, deletion in another tab). Treat a
  // genuinely deleted preset exactly like an unset selection so those records
  // self-heal instead of becoming permanently unsaveable/unrunnable.
  if (!preset) {
    const defaultPresetId = await ensureDefaultPreset(ctx, userId)
    if (options?.autoEnvironment === false) return defaultPresetId
    return await ensureAutoEnvironmentPreset(ctx, userId)
  }
  if (preset.userId !== userId) {
    throwUserError("Preset not found.")
  }

  return preset._id
}

export async function requireOwnedPreset(
  ctx: QueryCtx | MutationCtx,
  presetId: Id<"sandboxPresets">,
  userId: Id<"users">
) {
  const preset = await ctx.db.get(presetId)

  if (!preset || preset.userId !== userId) {
    throwUserError("Preset not found.")
  }

  return preset
}
