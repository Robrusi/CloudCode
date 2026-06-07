import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import { sandboxAccessForUser } from "./lib/sandboxAccess"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"

const MAX_LABEL_LENGTH = 60

function cleanLabel(label: string) {
  return label.trim().slice(0, MAX_LABEL_LENGTH)
}

/**
 * List the current user's SSH access tokens for a sandbox, newest first. The
 * raw token is intentionally omitted: callers that need it (to revoke) read it
 * server-side via `get`.
 */
export const list = query({
  args: {
    sandboxId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []

    const rows = await ctx.db
      .query("sshAccessTokens")
      .withIndex("by_user_sandbox", (q) =>
        q.eq("userId", user._id).eq("sandboxId", args.sandboxId)
      )
      .collect()

    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        id: row._id,
        accessId: row.accessId,
        label: row.label,
        sshCommand: row.sshCommand,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      }))
  },
})

/**
 * Fetch a single token record including the secret token. Owner-gated; used by
 * the server route to revoke the token with Daytona before deleting the row.
 */
export const get = query({
  args: {
    id: v.id("sshAccessTokens"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    const row = await ctx.db.get(args.id)
    if (!row || row.userId !== user._id) return null

    return {
      id: row._id,
      sandboxId: row.sandboxId,
      token: row.token,
    }
  },
})

export const create = mutation({
  args: {
    accessId: v.string(),
    expiresAt: v.number(),
    label: v.string(),
    sandboxId: v.string(),
    sshCommand: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const access = await sandboxAccessForUser(ctx, args.sandboxId, userId)
    if (!access) throw new Error("Sandbox not found.")

    // Keep the list bounded by dropping this user's already-expired records for
    // the sandbox whenever a new one is minted.
    const now = Date.now()
    const existing = await ctx.db
      .query("sshAccessTokens")
      .withIndex("by_user_sandbox", (q) =>
        q.eq("userId", userId).eq("sandboxId", args.sandboxId)
      )
      .collect()
    for (const row of existing) {
      if (row.expiresAt <= now) await ctx.db.delete(row._id)
    }

    return await ctx.db.insert("sshAccessTokens", {
      accessId: args.accessId,
      createdAt: now,
      expiresAt: args.expiresAt,
      label: cleanLabel(args.label),
      sandboxId: args.sandboxId,
      sshCommand: args.sshCommand,
      token: args.token,
      updatedAt: now,
      userId,
    })
  },
})

export const rename = mutation({
  args: {
    id: v.id("sshAccessTokens"),
    label: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const row = await ctx.db.get(args.id)
    if (!row || row.userId !== userId) throw new Error("SSH key not found.")

    await ctx.db.patch(row._id, {
      label: cleanLabel(args.label),
      updatedAt: Date.now(),
    })
  },
})

export const remove = mutation({
  args: {
    id: v.id("sshAccessTokens"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const row = await ctx.db.get(args.id)
    if (!row || row.userId !== userId) throw new Error("SSH key not found.")

    await ctx.db.delete(row._id)
  },
})
