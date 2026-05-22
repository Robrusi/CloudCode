import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"

function toStatus(auth: {
  accountId: string | null
  authMode: "chatgpt"
  fingerprint: string
  lastRefresh: string
  profile: string
  updatedAt: string
}) {
  return {
    accountId: auth.accountId,
    authMode: auth.authMode,
    exists: true,
    fingerprint: auth.fingerprint,
    lastRefresh: auth.lastRefresh,
    profile: auth.profile,
    updatedAt: auth.updatedAt,
  }
}

export const status = query({
  args: {
    profile: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) {
      return {
        exists: false,
        profile: args.profile,
      }
    }

    const stored = await ctx.db
      .query("codexAuth")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", user._id).eq("profile", args.profile)
      )
      .unique()

    if (!stored) {
      return {
        exists: false,
        profile: args.profile,
      }
    }

    return toStatus(stored)
  },
})

export const get = query({
  args: {
    profile: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    return await ctx.db
      .query("codexAuth")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", user._id).eq("profile", args.profile)
      )
      .unique()
  },
})

export const saveOAuthTokens = mutation({
  args: {
    accessToken: v.string(),
    accountId: v.union(v.string(), v.null()),
    fingerprint: v.string(),
    idToken: v.string(),
    lastRefresh: v.string(),
    openaiApiKey: v.optional(v.string()),
    profile: v.string(),
    refreshToken: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const existing = await ctx.db
      .query("codexAuth")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", userId).eq("profile", args.profile)
      )
      .unique()

    const auth = {
      accessToken: args.accessToken,
      accountId: args.accountId,
      authMode: "chatgpt" as const,
      fingerprint: args.fingerprint,
      idToken: args.idToken,
      lastRefresh: args.lastRefresh,
      openaiApiKey: args.openaiApiKey,
      profile: args.profile,
      refreshToken: args.refreshToken,
      updatedAt: args.lastRefresh,
      userId,
    }

    if (existing) {
      await ctx.db.patch(existing._id, auth)
    } else {
      await ctx.db.insert("codexAuth", auth)
    }

    return toStatus(auth)
  },
})

export const saveOAuthTokensForWorker = mutation({
  args: {
    accessToken: v.string(),
    accountId: v.union(v.string(), v.null()),
    fingerprint: v.string(),
    idToken: v.string(),
    lastRefresh: v.string(),
    openaiApiKey: v.optional(v.string()),
    profile: v.string(),
    refreshToken: v.string(),
    userId: v.id("users"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const existing = await ctx.db
      .query("codexAuth")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", args.userId).eq("profile", args.profile)
      )
      .unique()

    const auth = {
      accessToken: args.accessToken,
      accountId: args.accountId,
      authMode: "chatgpt" as const,
      fingerprint: args.fingerprint,
      idToken: args.idToken,
      lastRefresh: args.lastRefresh,
      openaiApiKey: args.openaiApiKey,
      profile: args.profile,
      refreshToken: args.refreshToken,
      updatedAt: args.lastRefresh,
      userId: args.userId,
    }

    if (existing) {
      await ctx.db.patch(existing._id, auth)
    } else {
      await ctx.db.insert("codexAuth", auth)
    }

    return toStatus(auth)
  },
})
