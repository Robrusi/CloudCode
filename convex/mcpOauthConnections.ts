import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { deleteMcpServerCascade } from "./lib/mcpServerRecords"
import { buildCustomServerFields } from "./lib/mcpServerValidation"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"

const PROVIDER_RE = /^[a-z0-9_-]{1,64}$/

function cleanProvider(value: string) {
  const provider = value.trim().toLowerCase()
  if (!PROVIDER_RE.test(provider)) {
    throw new Error("Unsupported MCP OAuth provider.")
  }
  return provider
}

async function connectionForUserProvider(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  provider: string
) {
  return await ctx.db
    .query("mcpOauthConnections")
    .withIndex("by_user_provider", (q) =>
      q.eq("userId", userId).eq("provider", provider)
    )
    .unique()
}

function toConnectionRow(connection: Doc<"mcpOauthConnections">) {
  return {
    connected: Boolean(connection.encryptedAccessToken),
    expiresAt: connection.expiresAt,
    id: connection._id,
    provider: connection.provider,
    serverId: connection.serverId,
    serverUrl: connection.serverUrl,
    updatedAt: connection.updatedAt,
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []

    const connections = await ctx.db
      .query("mcpOauthConnections")
      .withIndex("by_user_provider", (q) => q.eq("userId", user._id))
      .collect()

    return connections
      .map(toConnectionRow)
      .sort((a, b) => a.provider.localeCompare(b.provider))
  },
})

// Full row including encrypted tokens and client credentials. Gated behind the
// worker secret so it is only reachable from our own server-side routes.
export const getForServer = query({
  args: {
    provider: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const user = await getCurrentUser(ctx)
    if (!user) return null
    return await connectionForUserProvider(
      ctx,
      user._id,
      cleanProvider(args.provider)
    )
  },
})

export const saveClientRegistration = mutation({
  args: {
    authorizationEndpoint: v.string(),
    clientId: v.string(),
    encryptedClientSecret: v.optional(v.string()),
    provider: v.string(),
    revocationEndpoint: v.optional(v.string()),
    serverUrl: v.string(),
    tokenEndpoint: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const userId = await ensureCurrentUser(ctx)
    const provider = cleanProvider(args.provider)
    const now = Date.now()
    const existing = await connectionForUserProvider(ctx, userId, provider)

    const registration = {
      authorizationEndpoint: args.authorizationEndpoint,
      clientId: args.clientId,
      encryptedClientSecret: args.encryptedClientSecret,
      provider,
      revocationEndpoint: args.revocationEndpoint,
      serverUrl: args.serverUrl,
      tokenEndpoint: args.tokenEndpoint,
      updatedAt: now,
    }

    if (existing) {
      await ctx.db.patch(existing._id, registration)
      return existing._id
    }

    return await ctx.db.insert("mcpOauthConnections", {
      ...registration,
      createdAt: now,
      userId,
    })
  },
})

export const completeAuthorization = mutation({
  args: {
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    provider: v.string(),
    scope: v.optional(v.string()),
    serverDisplayName: v.string(),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const userId = await ensureCurrentUser(ctx)
    const provider = cleanProvider(args.provider)
    const now = Date.now()
    const connection = await connectionForUserProvider(ctx, userId, provider)
    if (!connection) {
      throw new Error("Start the OAuth flow before completing authorization.")
    }

    const { fields, serverName } = buildCustomServerFields(
      {
        name: args.serverDisplayName,
        transport: "http",
        url: connection.serverUrl,
      },
      now
    )

    let serverId = connection.serverId
    const linked = serverId ? await ctx.db.get(serverId) : null
    let server = linked && linked.userId === userId ? linked : null
    if (!server) {
      server = await ctx.db
        .query("mcpServers")
        .withIndex("by_user_server_name", (q) =>
          q.eq("userId", userId).eq("serverName", serverName)
        )
        .unique()
    }

    if (server) {
      serverId = server._id
      await ctx.db.patch(server._id, { ...fields, enabled: true })
    } else {
      serverId = await ctx.db.insert("mcpServers", {
        ...fields,
        createdAt: now,
        enabled: true,
        userId,
      })
    }

    await ctx.db.patch(connection._id, {
      encryptedAccessToken: args.encryptedAccessToken,
      encryptedRefreshToken: args.encryptedRefreshToken,
      expiresAt: args.expiresAt,
      scope: args.scope,
      serverId,
      updatedAt: now,
    })

    return { connectionId: connection._id, serverId }
  },
})

export const disconnect = mutation({
  args: {
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const connection = await connectionForUserProvider(
      ctx,
      userId,
      cleanProvider(args.provider)
    )
    if (!connection) return { deletedConnection: false, deletedServer: false }

    let deletedServer = false
    if (connection.serverId) {
      const server = await ctx.db.get(connection.serverId)
      if (server && server.userId === userId) {
        await deleteMcpServerCascade(ctx, server._id)
        deletedServer = true
      }
    }

    await ctx.db.delete(connection._id)
    return { deletedConnection: true, deletedServer }
  },
})

export const workerSaveTokens = mutation({
  args: {
    connectionId: v.id("mcpOauthConnections"),
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    runId: v.id("codexRuns"),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const [run, connection] = await Promise.all([
      ctx.db.get(args.runId),
      ctx.db.get(args.connectionId),
    ])
    if (!run) throw new Error("Run not found.")
    if (!connection || connection.userId !== run.userId) {
      throw new Error("MCP OAuth connection not found.")
    }

    await ctx.db.patch(connection._id, {
      encryptedAccessToken: args.encryptedAccessToken,
      encryptedRefreshToken:
        args.encryptedRefreshToken ?? connection.encryptedRefreshToken,
      expiresAt: args.expiresAt,
      updatedAt: Date.now(),
    })
  },
})
