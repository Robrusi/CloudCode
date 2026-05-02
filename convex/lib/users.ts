import type { MutationCtx, QueryCtx } from "../_generated/server"

type Ctx = QueryCtx | MutationCtx

export async function getCurrentUser(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity()

  if (!identity) {
    return null
  }

  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier)
    )
    .unique()
}

export async function requireCurrentUser(ctx: Ctx) {
  const user = await getCurrentUser(ctx)

  if (!user) {
    throw new Error("Not authenticated.")
  }

  return user
}

export async function ensureCurrentUser(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()

  if (!identity) {
    throw new Error("Not authenticated.")
  }

  const now = Date.now()
  const existing = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier)
    )
    .unique()

  const patch = {
    email: identity.email,
    imageUrl: identity.pictureUrl,
    name: identity.name,
    subject: identity.subject,
    tokenIdentifier: identity.tokenIdentifier,
    updatedAt: now,
  }

  if (existing) {
    await ctx.db.patch(existing._id, patch)
    return existing._id
  }

  return await ctx.db.insert("users", {
    ...patch,
    createdAt: now,
  })
}
