import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"
import { codexAuthReconnectMessage } from "@/lib/codex/auth-errors"

function toStatus(auth: {
  accountEmail?: string
  accountId: string | null
  accountName?: string
  authMode: "chatgpt"
  displayName?: string
  fingerprint: string
  invalidReason?: string
  invalidatedAt?: string
  lastRefresh: string
  profile: string
  updatedAt: string
}) {
  return {
    ...(auth.accountEmail ? { accountEmail: auth.accountEmail } : {}),
    accountId: auth.accountId,
    ...(auth.accountName ? { accountName: auth.accountName } : {}),
    authMode: auth.authMode,
    ...(auth.displayName ? { displayName: auth.displayName } : {}),
    exists: true as const,
    fingerprint: auth.fingerprint,
    ...(auth.invalidReason ? { invalidReason: auth.invalidReason } : {}),
    ...(auth.invalidatedAt ? { invalidatedAt: auth.invalidatedAt } : {}),
    lastRefresh: auth.lastRefresh,
    profile: auth.profile,
    updatedAt: auth.updatedAt,
  }
}

function normalizedDisplayName(displayName: string) {
  const normalized = displayName.trim()

  if (normalized.length > 80) {
    throw new Error("ChatGPT account name must be 80 characters or fewer.")
  }

  return normalized
}

async function authRecordsForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">
) {
  return await ctx.db
    .query("codexAuth")
    .withIndex("by_user_updated", (q) => q.eq("userId", userId))
    .order("desc")
    .collect()
}

function activeProfileForUser(
  user: Pick<Doc<"users">, "activeCodexProfile">,
  auths: Doc<"codexAuth">[]
) {
  const active = user.activeCodexProfile?.trim()
  const usableAuths = auths.filter((auth) => !auth.invalidatedAt)

  if (active && usableAuths.some((auth) => auth.profile === active)) {
    return active
  }
  if (usableAuths.some((auth) => auth.profile === "default")) return "default"

  return usableAuths[0]?.profile ?? auths[0]?.profile ?? active ?? "default"
}

function overviewForUser(
  user: Pick<Doc<"users">, "activeCodexProfile">,
  auths: Doc<"codexAuth">[],
  requestedProfile?: string
) {
  const activeProfile = activeProfileForUser(user, auths)
  const profile = requestedProfile?.trim() || activeProfile
  const selected = auths.find((auth) => auth.profile === profile)
  const accounts = auths.map(toStatus).sort((a, b) => {
    if (a.profile === activeProfile) return -1
    if (b.profile === activeProfile) return 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })

  return {
    ...(selected ? toStatus(selected) : { exists: false, profile }),
    accounts,
    activeProfile,
  }
}

async function existingAuthForAccount(
  ctx: MutationCtx,
  userId: Id<"users">,
  accountId: string | null
) {
  if (!accountId) return null
  const auths = await authRecordsForUser(ctx, userId)

  return auths.find((auth) => auth.accountId === accountId) ?? null
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

export const overview = query({
  args: {
    profile: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) {
      const profile = args.profile ?? "default"

      return {
        accounts: [],
        activeProfile: profile,
        exists: false,
        profile,
      }
    }

    return overviewForUser(
      user,
      await authRecordsForUser(ctx, user._id),
      args.profile
    )
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
    accountEmail: v.optional(v.string()),
    accountId: v.union(v.string(), v.null()),
    accountName: v.optional(v.string()),
    activate: v.optional(v.boolean()),
    fingerprint: v.string(),
    idToken: v.string(),
    lastRefresh: v.string(),
    openaiApiKey: v.optional(v.string()),
    profile: v.string(),
    refreshToken: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const user = await ctx.db.get(userId)
    if (!user) throw new Error("Not authenticated.")
    const existing = await ctx.db
      .query("codexAuth")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", userId).eq("profile", args.profile)
      )
      .unique()
    const existingAccount = existing
      ? null
      : await existingAuthForAccount(ctx, userId, args.accountId)
    const targetAuth = existing ?? existingAccount
    const profile = targetAuth?.profile ?? args.profile

    const auth = {
      accessToken: args.accessToken,
      accountEmail: args.accountEmail,
      accountId: args.accountId,
      accountName: args.accountName,
      authMode: "chatgpt" as const,
      fingerprint: args.fingerprint,
      idToken: args.idToken,
      invalidReason: undefined,
      invalidatedAt: undefined,
      lastRefresh: args.lastRefresh,
      openaiApiKey: args.openaiApiKey,
      profile,
      refreshToken: args.refreshToken,
      updatedAt: args.lastRefresh,
      userId,
    }

    if (targetAuth) {
      await ctx.db.patch(targetAuth._id, auth)
    } else {
      await ctx.db.insert("codexAuth", auth)
    }

    if (args.activate !== false) {
      await ctx.db.patch(userId, {
        activeCodexProfile: profile,
        updatedAt: Date.now(),
      })
    }

    const auths = await authRecordsForUser(ctx, userId)
    return overviewForUser(
      {
        ...user,
        activeCodexProfile:
          args.activate === false ? user.activeCodexProfile : profile,
      },
      auths,
      profile
    )
  },
})

export const setActiveProfile = mutation({
  args: {
    profile: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const user = await ctx.db.get(userId)
    if (!user) throw new Error("Not authenticated.")

    const auth = await ctx.db
      .query("codexAuth")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", userId).eq("profile", args.profile)
      )
      .unique()

    if (!auth) {
      throw new Error("ChatGPT account is not connected.")
    }
    if (auth.invalidatedAt) {
      throw new Error(codexAuthReconnectMessage(args.profile))
    }

    await ctx.db.patch(userId, {
      activeCodexProfile: args.profile,
      updatedAt: Date.now(),
    })

    return overviewForUser(
      { ...user, activeCodexProfile: args.profile },
      await authRecordsForUser(ctx, userId),
      args.profile
    )
  },
})

export const renameProfile = mutation({
  args: {
    displayName: v.string(),
    profile: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const user = await ctx.db.get(userId)
    if (!user) throw new Error("Not authenticated.")

    const auth = await ctx.db
      .query("codexAuth")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", userId).eq("profile", args.profile)
      )
      .unique()

    if (!auth) {
      throw new Error("ChatGPT account is not connected.")
    }

    const displayName = normalizedDisplayName(args.displayName)

    await ctx.db.patch(auth._id, {
      displayName: displayName || undefined,
    })

    return overviewForUser(
      user,
      await authRecordsForUser(ctx, userId),
      args.profile
    )
  },
})

export const disconnectProfile = mutation({
  args: {
    profile: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const user = await ctx.db.get(userId)
    if (!user) throw new Error("Not authenticated.")

    const auth = await ctx.db
      .query("codexAuth")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", userId).eq("profile", args.profile)
      )
      .unique()

    if (!auth) {
      throw new Error("ChatGPT account is not connected.")
    }

    await ctx.db.delete(auth._id)

    const remainingAuths = await authRecordsForUser(ctx, userId)
    const nextUser = {
      ...user,
      activeCodexProfile:
        remainingAuths.length > 0
          ? activeProfileForUser(
              {
                ...user,
                activeCodexProfile:
                  user.activeCodexProfile === args.profile
                    ? undefined
                    : user.activeCodexProfile,
              },
              remainingAuths
            )
          : undefined,
    }

    await ctx.db.patch(userId, {
      activeCodexProfile: nextUser.activeCodexProfile,
      updatedAt: Date.now(),
    })

    return overviewForUser(nextUser, remainingAuths)
  },
})

export const saveOAuthTokensForWorker = mutation({
  args: {
    accessToken: v.string(),
    accountId: v.union(v.string(), v.null()),
    expectedFingerprint: v.optional(v.string()),
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

    if (
      args.expectedFingerprint &&
      existing &&
      existing.fingerprint !== args.expectedFingerprint
    ) {
      return toStatus(existing)
    }

    const auth = {
      accessToken: args.accessToken,
      accountId: args.accountId,
      authMode: "chatgpt" as const,
      fingerprint: args.fingerprint,
      idToken: args.idToken,
      invalidReason: undefined,
      invalidatedAt: undefined,
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

export const invalidateOAuthTokensForWorker = mutation({
  args: {
    invalidReason: v.string(),
    profile: v.string(),
    userId: v.id("users"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const [user, existing] = await Promise.all([
      ctx.db.get(args.userId),
      ctx.db
        .query("codexAuth")
        .withIndex("by_user_profile", (q) =>
          q.eq("userId", args.userId).eq("profile", args.profile)
        )
        .unique(),
    ])
    if (!existing) return null

    const invalidatedAt = new Date().toISOString()
    await ctx.db.patch(existing._id, {
      invalidReason: args.invalidReason,
      invalidatedAt,
      updatedAt: invalidatedAt,
    })

    if (user?.activeCodexProfile === args.profile) {
      const auths = (await authRecordsForUser(ctx, args.userId)).map((auth) =>
        auth._id === existing._id
          ? {
              ...auth,
              invalidReason: args.invalidReason,
              invalidatedAt,
              updatedAt: invalidatedAt,
            }
          : auth
      )

      await ctx.db.patch(args.userId, {
        activeCodexProfile: activeProfileForUser(user, auths),
        updatedAt: Date.now(),
      })
    }

    return toStatus({
      ...existing,
      invalidReason: args.invalidReason,
      invalidatedAt,
      updatedAt: invalidatedAt,
    })
  },
})
