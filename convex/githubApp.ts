import { v } from "convex/values"

import type { Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx } from "./_generated/server"
import { requireWorkerSecret } from "./lib/workerAuth"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"

function toInstallation(installation: {
  accountId?: string
  accountLogin: string
  accountType?: string
  htmlUrl?: string
  installationId: string
  repositorySelection?: string
  updatedAt: string
}) {
  return {
    accountId: installation.accountId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    htmlUrl: installation.htmlUrl,
    installationId: installation.installationId,
    repositorySelection: installation.repositorySelection,
    updatedAt: installation.updatedAt,
  }
}

function toUserStatus(userAuth: {
  email?: string
  fingerprint: string
  githubUserId: string
  login: string
  name?: string
  updatedAt: string
}) {
  return {
    connected: true,
    email: userAuth.email,
    fingerprint: userAuth.fingerprint,
    githubUserId: userAuth.githubUserId,
    login: userAuth.login,
    name: userAuth.name,
    updatedAt: userAuth.updatedAt,
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []

    const installations = await ctx.db
      .query("githubAppInstallations")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()

    return installations
      .map(toInstallation)
      .sort((a, b) => a.accountLogin.localeCompare(b.accountLogin))
  },
})

export const saveInstallation = mutation({
  args: {
    accountId: v.optional(v.string()),
    accountLogin: v.string(),
    accountType: v.optional(v.string()),
    htmlUrl: v.optional(v.string()),
    installationId: v.string(),
    repositorySelection: v.optional(v.string()),
    updatedAt: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const userId = await ensureCurrentUser(ctx)
    const existing = await ctx.db
      .query("githubAppInstallations")
      .withIndex("by_user_installation", (q) =>
        q.eq("userId", userId).eq("installationId", args.installationId)
      )
      .unique()

    const installation = {
      accountId: args.accountId,
      accountLogin: args.accountLogin,
      accountType: args.accountType,
      htmlUrl: args.htmlUrl,
      installationId: args.installationId,
      repositorySelection: args.repositorySelection,
      updatedAt: args.updatedAt,
      userId,
    }

    if (existing) {
      await ctx.db.patch(existing._id, installation)
    } else {
      await ctx.db.insert("githubAppInstallations", installation)
    }

    return toInstallation(installation)
  },
})

export const replaceInstallations = mutation({
  args: {
    installations: v.array(
      v.object({
        accountId: v.optional(v.string()),
        accountLogin: v.string(),
        accountType: v.optional(v.string()),
        htmlUrl: v.optional(v.string()),
        installationId: v.string(),
        repositorySelection: v.optional(v.string()),
        updatedAt: v.string(),
      })
    ),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const userId = await ensureCurrentUser(ctx)
    const currentInstallations = [
      ...new Map(
        args.installations.map((installation) => [
          installation.installationId,
          installation,
        ])
      ).values(),
    ]
    const currentIds = new Set(
      currentInstallations.map((installation) => installation.installationId)
    )
    const installations = await ctx.db
      .query("githubAppInstallations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
    const existingByInstallationId = new Map(
      installations.map((installation) => [
        installation.installationId,
        installation,
      ])
    )
    const retainedRowIds = new Set<(typeof installations)[number]["_id"]>()

    for (const input of currentInstallations) {
      const installation = {
        accountId: input.accountId,
        accountLogin: input.accountLogin,
        accountType: input.accountType,
        htmlUrl: input.htmlUrl,
        installationId: input.installationId,
        repositorySelection: input.repositorySelection,
        updatedAt: input.updatedAt,
        userId,
      }
      const existing = existingByInstallationId.get(input.installationId)

      if (existing) {
        retainedRowIds.add(existing._id)
        await ctx.db.patch(existing._id, installation)
      } else {
        await ctx.db.insert("githubAppInstallations", installation)
      }
    }

    const stale = installations.filter(
      (installation) =>
        !currentIds.has(installation.installationId) ||
        !retainedRowIds.has(installation._id)
    )
    for (const installation of stale) {
      await ctx.db.delete(installation._id)
    }

    return {
      installations: currentInstallations
        .map(toInstallation)
        .sort((a, b) => a.accountLogin.localeCompare(b.accountLogin)),
      deletedInstallations: stale.length,
    }
  },
})

export const userStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) {
      return {
        connected: false,
      }
    }

    const stored = await ctx.db
      .query("githubAppUsers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique()

    return stored ? toUserStatus(stored) : { connected: false }
  },
})

export const getUserAuth = query({
  args: {
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const user = await getCurrentUser(ctx)
    if (!user) return null

    return await ctx.db
      .query("githubAppUsers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique()
  },
})

export const getUserAuthForWorker = query({
  args: {
    userId: v.id("users"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    return await ctx.db
      .query("githubAppUsers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique()
  },
})

export const installationsForWorker = query({
  args: {
    userId: v.id("users"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const installations = await ctx.db
      .query("githubAppInstallations")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    return installations
      .map(toInstallation)
      .sort((a, b) => a.accountLogin.localeCompare(b.accountLogin))
  },
})

const saveUserAuthFields = {
  email: v.optional(v.string()),
  encryptedRefreshToken: v.optional(v.string()),
  encryptedToken: v.string(),
  expiresAt: v.optional(v.string()),
  fingerprint: v.string(),
  githubUserId: v.string(),
  login: v.string(),
  name: v.optional(v.string()),
  refreshTokenExpiresAt: v.optional(v.string()),
  updatedAt: v.string(),
}

async function upsertUserAuth(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: {
    email?: string
    encryptedRefreshToken?: string
    encryptedToken: string
    expiresAt?: string
    fingerprint: string
    githubUserId: string
    login: string
    name?: string
    refreshTokenExpiresAt?: string
    updatedAt: string
  }
) {
  const existing = await ctx.db
    .query("githubAppUsers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique()

  const auth = {
    email: args.email,
    encryptedRefreshToken: args.encryptedRefreshToken,
    encryptedToken: args.encryptedToken,
    expiresAt: args.expiresAt,
    fingerprint: args.fingerprint,
    githubUserId: args.githubUserId,
    login: args.login,
    name: args.name,
    refreshTokenExpiresAt: args.refreshTokenExpiresAt,
    updatedAt: args.updatedAt,
    userId,
  }

  if (existing) {
    await ctx.db.patch(existing._id, auth)
  } else {
    await ctx.db.insert("githubAppUsers", auth)
  }

  return toUserStatus(auth)
}

export const saveUserAuth = mutation({
  args: {
    ...saveUserAuthFields,
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const userId = await ensureCurrentUser(ctx)

    return await upsertUserAuth(ctx, userId, args)
  },
})

export const saveUserAuthForWorker = mutation({
  args: {
    ...saveUserAuthFields,
    userId: v.id("users"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)

    return await upsertUserAuth(ctx, args.userId, args)
  },
})

export const disconnectUser = mutation({
  args: {
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const userId = await ensureCurrentUser(ctx)
    const [installations, userAuth] = await Promise.all([
      ctx.db
        .query("githubAppInstallations")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("githubAppUsers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    ])

    await Promise.all([
      ...installations.map((installation) => ctx.db.delete(installation._id)),
      userAuth ? ctx.db.delete(userAuth._id) : Promise.resolve(),
    ])

    return {
      deletedInstallations: installations.length,
      deletedUserAuth: Boolean(userAuth),
    }
  },
})
