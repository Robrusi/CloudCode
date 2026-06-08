import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"
import { requireWorkerSecret } from "./lib/workerAuth"
import { splitMcpLaunchCommand } from "../lib/mcp-config"

const MCP_SERVER_NAME_RE = /^[A-Za-z0-9_-]+$/
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

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

type McpServerDoc = Doc<"mcpServers">

function cleanName(value: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error("MCP server name is required.")
  if (trimmed.length > 80) throw new Error("MCP server name is too long.")
  return trimmed
}

function cleanServerName(value: string) {
  const trimmed = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)

  if (!trimmed) throw new Error("MCP server name is required.")
  if (!MCP_SERVER_NAME_RE.test(trimmed)) {
    throw new Error(
      "MCP server names can only contain letters, numbers, underscores, and dashes."
    )
  }
  return trimmed
}

function cleanToolName(value: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error("MCP tool name is required.")
  if (trimmed.length > 160) throw new Error("MCP tool name is too long.")
  if (
    Array.from(trimmed).some((char) => {
      const code = char.charCodeAt(0)
      return code < 32 || code === 127
    })
  ) {
    throw new Error("MCP tool names cannot contain control characters.")
  }
  return trimmed
}

function cleanOptionalString(value: string | undefined, max: number) {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed.length > max) throw new Error("MCP value is too long.")
  return trimmed
}

function truncateOptionalString(value: string | undefined, max: number) {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function cleanUrl(value: string | undefined) {
  const trimmed = cleanOptionalString(value, 500)
  if (!trimmed) return undefined

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error("MCP server URL must be a valid URL.")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("MCP server URL must use http or https.")
  }
  return trimmed
}

function cleanEnvName(name: string) {
  const trimmed = name.trim()
  if (!ENV_NAME_RE.test(trimmed)) {
    throw new Error(
      "Environment variable names must start with a letter or underscore and contain only letters, numbers, and underscores."
    )
  }
  return trimmed
}

function cleanHeaderName(name: string) {
  const trimmed = name.trim()
  if (!HEADER_NAME_RE.test(trimmed)) {
    throw new Error("Header names contain unsupported characters.")
  }
  return trimmed
}

function cleanArgs(args: string[] | undefined) {
  return args
    ?.map((arg) => arg.trim())
    .filter(Boolean)
    .slice(0, 40)
}

function cleanEnvVars(envVars: string[] | undefined) {
  return Array.from(new Set((envVars ?? []).map(cleanEnvName))).slice(0, 80)
}

function cleanTimeout(value: number | undefined) {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 1 || value > 600) {
    throw new Error("MCP timeouts must be between 1 and 600 seconds.")
  }
  return Math.floor(value)
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

async function serverChildren(ctx: QueryCtx, server: McpServerDoc) {
  const [secrets, tools] = await Promise.all([
    ctx.db
      .query("mcpServerSecrets")
      .withIndex("by_server", (q) => q.eq("serverId", server._id))
      .collect(),
    ctx.db
      .query("mcpServerTools")
      .withIndex("by_server", (q) => q.eq("serverId", server._id))
      .collect(),
  ])

  return {
    secrets: secrets
      .map((secret) => ({
        id: secret._id,
        kind: secret.kind,
        name: secret.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    tools: tools
      .map((tool) => ({
        description: tool.description,
        id: tool._id,
        name: tool.name,
        policy: tool.policy,
        title: tool.title,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
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
      servers.map(async (server) => ({
        args: server.args,
        bearerTokenEnvVar: server.bearerTokenEnvVar,
        command: server.command,
        createdAt: server.createdAt,
        cwd: server.cwd,
        description: server.description,
        enabled: server.enabled,
        envVars: server.envVars,
        id: server._id,
        name: server.name,
        serverName: server.serverName,
        startupTimeoutSec: server.startupTimeoutSec,
        toolTimeoutSec: server.toolTimeoutSec,
        transport: server.transport,
        updatedAt: server.updatedAt,
        url: server.url,
        ...(await serverChildren(ctx, server)),
      }))
    )
  },
})

export const saveCustom = mutation({
  args: customServerInput,
  handler: async (ctx, args) => {
    const userId = await ensureCurrentUser(ctx)
    const now = Date.now()
    const name = cleanName(args.name)
    const serverName = cleanServerName(name)
    const argsList = cleanArgs(args.args)
    const envVars = cleanEnvVars(args.envVars)
    const transport = args.transport
    const commandParts =
      transport === "stdio" ? splitMcpLaunchCommand(args.command ?? "") : []

    if (transport === "stdio" && !commandParts.length) {
      throw new Error("Command is required for STDIO MCP servers.")
    }
    if (transport === "http" && !args.url?.trim()) {
      throw new Error("URL is required for HTTP MCP servers.")
    }

    let serverId = args.serverId
    if (serverId) {
      await requireOwnedServer(ctx, serverId, userId)
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

    const fields = {
      args:
        transport === "stdio"
          ? [...commandParts.slice(1), ...(argsList ?? [])]
          : argsList,
      bearerTokenEnvVar:
        transport === "http"
          ? cleanOptionalString(args.bearerTokenEnvVar, 80)
          : undefined,
      command:
        transport === "stdio"
          ? cleanOptionalString(commandParts[0], 500)
          : undefined,
      cwd:
        transport === "stdio" ? cleanOptionalString(args.cwd, 500) : undefined,
      description: undefined,
      enabled: true,
      envVars,
      name,
      serverName,
      startupTimeoutSec: cleanTimeout(args.startupTimeoutSec) ?? 20,
      toolTimeoutSec: cleanTimeout(args.toolTimeoutSec) ?? 60,
      transport,
      updatedAt: now,
      url: transport === "http" ? cleanUrl(args.url) : undefined,
    }

    if (serverId) {
      await ctx.db.patch(serverId, fields)
    } else {
      serverId = await ctx.db.insert("mcpServers", {
        ...fields,
        createdAt: now,
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
    await requireOwnedServer(ctx, args.serverId, userId)
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
    await requireOwnedServer(ctx, args.serverId, userId)
    const [secrets, tools] = await Promise.all([
      ctx.db
        .query("mcpServerSecrets")
        .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
        .collect(),
      ctx.db
        .query("mcpServerTools")
        .withIndex("by_server", (q) => q.eq("serverId", args.serverId))
        .collect(),
    ])
    await Promise.all([
      ...secrets.map((secret) => ctx.db.delete(secret._id)),
      ...tools.map((tool) => ctx.db.delete(tool._id)),
    ])
    await ctx.db.delete(args.serverId)
  },
})
