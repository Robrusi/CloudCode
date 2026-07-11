import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import {
  deleteMcpServerCascade,
  mcpServerListRow,
} from "./lib/mcpServerRecords"
import {
  buildCustomServerFields,
  cleanEnvName,
  cleanHeaderName,
  cleanOptionalString,
  cleanToolName,
  truncateOptionalString,
} from "./lib/mcpServerValidation"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"

const keyValue = v.object({
  name: v.string(),
  value: v.string(),
})

const toolInput = v.object({
  description: v.optional(v.string()),
  name: v.string(),
  policy: v.union(v.literal("auto"), v.literal("prompt"), v.literal("never")),
  title: v.optional(v.string()),
})

const discoveredServerInput = v.object({
  name: v.string(),
  tools: v.array(
    v.object({
      description: v.optional(v.string()),
      name: v.string(),
      title: v.optional(v.string()),
    })
  ),
})

const customServerInput = {
  args: v.optional(v.array(v.string())),
  bearerTokenEnvVar: v.optional(v.string()),
  command: v.optional(v.string()),
  cwd: v.optional(v.string()),
  envHttpHeaders: v.optional(v.array(keyValue)),
  envVars: v.optional(v.array(v.string())),
  httpHeaders: v.optional(v.array(keyValue)),
  name: v.string(),
  secrets: v.optional(v.array(keyValue)),
  serverId: v.optional(v.id("mcpServers")),
  startupTimeoutSec: v.optional(v.number()),
  toolTimeoutSec: v.optional(v.number()),
  tools: v.optional(v.array(toolInput)),
  transport: v.union(v.literal("stdio"), v.literal("http")),
  url: v.optional(v.string()),
}

async function requireOwnedServer(
  ctx: QueryCtx | MutationCtx,
  serverId: Id<"mcpServers">,
  userId: Id<"users">
) {
  const server = await ctx.db.get(serverId)
  if (!server || server.userId !== userId) {
    throw new Error("MCP server not found.")
  }
  return server
}

async function requireEditableServer(
  ctx: MutationCtx,
  serverId: Id<"mcpServers">,
  userId: Id<"users">
) {
  const server = await requireOwnedServer(ctx, serverId, userId)
  if (server.integrationInstallationId) {
    throw new Error("Manage this MCP server from its integration connection.")
  }
  return server
}

async function insertSecrets(
  ctx: MutationCtx,
  serverId: Id<"mcpServers">,
  userId: Id<"users">,
  secrets: Array<{
    kind: "env" | "httpHeader" | "envHttpHeader"
    name: string
    value: string
  }>
) {
  const now = Date.now()
  for (const secret of secrets) {
    await ctx.db.insert("mcpServerSecrets", {
      createdAt: now,
      kind: secret.kind,
      name:
        secret.kind === "env"
          ? cleanEnvName(secret.name)
          : cleanHeaderName(secret.name),
      serverId,
      updatedAt: now,
      userId,
      value: secret.value,
    })
  }
}

async function replaceSecrets(
  ctx: MutationCtx,
  serverId: Id<"mcpServers">,
  userId: Id<"users">,
  secrets: Array<{
    kind: "env" | "httpHeader" | "envHttpHeader"
    name: string
    value: string
  }>
) {
  const existing = await ctx.db
    .query("mcpServerSecrets")
    .withIndex("by_server", (q) => q.eq("serverId", serverId))
    .collect()

  await Promise.all(existing.map((secret) => ctx.db.delete(secret._id)))
  await insertSecrets(ctx, serverId, userId, secrets)
}

async function upsertTools(
  ctx: MutationCtx,
  serverId: Id<"mcpServers">,
  userId: Id<"users">,
  tools: Array<{
    description?: string
    name: string
    policy: "auto" | "prompt" | "never"
    title?: string
  }>
) {
  const existing = await ctx.db
    .query("mcpServerTools")
    .withIndex("by_server", (q) => q.eq("serverId", serverId))
    .collect()
  const existingByName = new Map(existing.map((tool) => [tool.name, tool]))
  const seen = new Set<string>()
  const now = Date.now()

  for (const tool of tools) {
    const name = cleanToolName(tool.name)
    seen.add(name)
    const patch = {
      description: cleanOptionalString(tool.description, 500),
      name,
      policy: tool.policy,
      title: cleanOptionalString(tool.title, 120),
      updatedAt: now,
    }
    const current = existingByName.get(name)
    if (current) {
      await ctx.db.patch(current._id, patch)
    } else {
      await ctx.db.insert("mcpServerTools", {
        ...patch,
        createdAt: now,
        serverId,
        userId,
      })
    }
  }

  await Promise.all(
    existing
      .filter((tool) => !seen.has(tool.name))
      .map((tool) => ctx.db.delete(tool._id))
  )
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []

    const servers = await ctx.db
      .query("mcpServers")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect()

    return await Promise.all(
      servers.map((server) => mcpServerListRow(ctx, server))
    )
  },
})

export const saveCustom = mutation({
  args: customServerInput,
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const now = Date.now()
    const { fields, serverName } = buildCustomServerFields(args, now)

    let serverId = args.serverId
    if (serverId) {
      await requireEditableServer(ctx, serverId, userId)
    } else {
      const existing = await ctx.db
        .query("mcpServers")
        .withIndex("by_user_server_name", (q) =>
          q.eq("userId", userId).eq("serverName", serverName)
        )
        .unique()
      if (existing) {
        throw new Error("An MCP server with this name already exists.")
      }
    }

    if (serverId) {
      await ctx.db.patch(serverId, { ...fields, enabled: true })
    } else {
      serverId = await ctx.db.insert("mcpServers", {
        ...fields,
        createdAt: now,
        enabled: true,
        userId,
      })
    }

    const secrets = [
      ...(args.secrets ?? []).map((secret) => ({
        kind: "env" as const,
        name: secret.name,
        value: secret.value,
      })),
      ...(args.httpHeaders ?? []).map((secret) => ({
        kind: "httpHeader" as const,
        name: secret.name,
        value: secret.value,
      })),
      ...(args.envHttpHeaders ?? []).map((secret) => ({
        kind: "envHttpHeader" as const,
        name: secret.name,
        value: secret.value,
      })),
    ].filter((secret) => secret.name.trim() && secret.value.trim())

    await replaceSecrets(ctx, serverId, userId, secrets)
    if (args.tools !== undefined) {
      await upsertTools(ctx, serverId, userId, args.tools)
    }

    return serverId
  },
})

export const updateCustom = mutation({
  args: {
    ...customServerInput,
    removeSecretIds: v.optional(v.array(v.id("mcpServerSecrets"))),
    serverId: v.id("mcpServers"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireEditableServer(ctx, args.serverId, userId)
    const now = Date.now()
    const { fields, serverName } = buildCustomServerFields(args, now)

    const conflict = await ctx.db
      .query("mcpServers")
      .withIndex("by_user_server_name", (q) =>
        q.eq("userId", userId).eq("serverName", serverName)
      )
      .unique()
    if (conflict && conflict._id !== args.serverId) {
      throw new Error("An MCP server with this name already exists.")
    }

    // Patch metadata only — `enabled` is intentionally preserved.
    await ctx.db.patch(args.serverId, fields)

    // Drop the secrets the user explicitly removed; the rest are kept as-is
    // since their encrypted values are never sent back to the client.
    for (const secretId of args.removeSecretIds ?? []) {
      const secret = await ctx.db.get(secretId)
      if (
        secret &&
        secret.serverId === args.serverId &&
        secret.userId === userId
      ) {
        await ctx.db.delete(secret._id)
      }
    }

    const newSecrets = [
      ...(args.secrets ?? []).map((secret) => ({
        kind: "env" as const,
        name: secret.name,
        value: secret.value,
      })),
      ...(args.httpHeaders ?? []).map((secret) => ({
        kind: "httpHeader" as const,
        name: secret.name,
        value: secret.value,
      })),
      ...(args.envHttpHeaders ?? []).map((secret) => ({
        kind: "envHttpHeader" as const,
        name: secret.name,
        value: secret.value,
      })),
    ].filter((secret) => secret.name.trim() && secret.value.trim())

    await insertSecrets(ctx, args.serverId, userId, newSecrets)

    return args.serverId
  },
})

export const updateToolPolicy = mutation({
  args: {
    policy: v.union(v.literal("auto"), v.literal("prompt"), v.literal("never")),
    toolId: v.id("mcpServerTools"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const tool = await ctx.db.get(args.toolId)
    if (!tool || tool.userId !== userId) throw new Error("Tool not found.")
    await ctx.db.patch(args.toolId, {
      policy: args.policy,
      updatedAt: Date.now(),
    })
  },
})

export const setEnabled = mutation({
  args: {
    enabled: v.boolean(),
    serverId: v.id("mcpServers"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireEditableServer(ctx, args.serverId, userId)
    await ctx.db.patch(args.serverId, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    })
  },
})

export const workerSyncDiscoveredTools = mutation({
  args: {
    runId: v.id("codexRuns"),
    servers: v.array(discoveredServerInput),
    workerSecret: v.string(),
  },
  handler: async (ctx, args) => {
    requireWorkerSecret(args.workerSecret)
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error("Run not found.")

    const now = Date.now()
    let synced = 0

    for (const discoveredServer of args.servers) {
      const server = await ctx.db
        .query("mcpServers")
        .withIndex("by_user_server_name", (q) =>
          q.eq("userId", run.userId).eq("serverName", discoveredServer.name)
        )
        .unique()
      if (!server) continue

      const existing = await ctx.db
        .query("mcpServerTools")
        .withIndex("by_server", (q) => q.eq("serverId", server._id))
        .collect()
      const existingByName = new Map(existing.map((tool) => [tool.name, tool]))
      const seen = new Set<string>()

      for (const discoveredTool of discoveredServer.tools) {
        let name: string
        try {
          name = cleanToolName(discoveredTool.name)
        } catch {
          continue
        }
        if (seen.has(name)) continue
        seen.add(name)

        const fields = {
          description: truncateOptionalString(discoveredTool.description, 500),
          name,
          title: truncateOptionalString(discoveredTool.title, 120),
          updatedAt: now,
        }
        const current = existingByName.get(name)
        if (current) {
          await ctx.db.patch(current._id, fields)
        } else {
          await ctx.db.insert("mcpServerTools", {
            ...fields,
            createdAt: now,
            policy: "prompt" as const,
            serverId: server._id,
            userId: run.userId,
          })
        }
        synced += 1
      }
    }

    return { synced }
  },
})

export const remove = mutation({
  args: {
    serverId: v.id("mcpServers"),
  },
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    await requireEditableServer(ctx, args.serverId, userId)
    await deleteMcpServerCascade(ctx, args.serverId)
  },
})
