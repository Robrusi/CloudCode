import type { Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"

const AUTO_ENVIRONMENT_PRESET = {
  environmentSlug: "auto",
  mode: "auto" as const,
  name: "Auto environment",
}

export async function ensureAutoEnvironmentPreset(
  ctx: MutationCtx,
  userId: Id<"users">
) {
  const existing = await ctx.db
    .query("sandboxPresets")
    .withIndex("by_user_mode", (q) =>
      q.eq("userId", userId).eq("mode", AUTO_ENVIRONMENT_PRESET.mode)
    )
    .first()

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
  userId: Id<"users">
) {
  if (!presetId) return await ensureAutoEnvironmentPreset(ctx, userId)

  const preset = await ctx.db.get(presetId)
  if (!preset || preset.userId !== userId) {
    throw new Error("Preset not found.")
  }

  return preset._id
}
