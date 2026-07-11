import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

type McpServerDoc = Doc<"mcpServers">

async function serverOauthConnection(ctx: QueryCtx, server: McpServerDoc) {
  return await ctx.db
    .query("mcpOauthConnections")
    .withIndex("by_server", (q) => q.eq("serverId", server._id))
    .unique()
}

export async function deleteMcpServerCascade(
  ctx: MutationCtx,
  serverId: Id<"mcpServers">
) {
  const [secrets, tools, connections] = await Promise.all([
    ctx.db
      .query("mcpServerSecrets")
      .withIndex("by_server", (q) => q.eq("serverId", serverId))
      .collect(),
    ctx.db
      .query("mcpServerTools")
      .withIndex("by_server", (q) => q.eq("serverId", serverId))
      .collect(),
    ctx.db
      .query("mcpOauthConnections")
      .withIndex("by_server", (q) => q.eq("serverId", serverId))
      .collect(),
  ])
  await Promise.all([
    ...secrets.map((secret) => ctx.db.delete(secret._id)),
    ...tools.map((tool) => ctx.db.delete(tool._id)),
    ...connections.map((connection) => ctx.db.delete(connection._id)),
  ])
  await ctx.db.delete(serverId)
}

export async function serverChildren(ctx: QueryCtx, server: McpServerDoc) {
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

export async function mcpServerListRow(ctx: QueryCtx, server: McpServerDoc) {
  const [oauthConnection, integrationInstallation] = await Promise.all([
    serverOauthConnection(ctx, server),
    server.integrationInstallationId
      ? ctx.db.get(server.integrationInstallationId)
      : null,
  ])

  return {
    oauthProvider: oauthConnection?.provider,
    args: server.args,
    bearerTokenEnvVar: server.bearerTokenEnvVar,
    command: server.command,
    createdAt: server.createdAt,
    cwd: server.cwd,
    description: server.description,
    enabled: server.enabled,
    envVars: server.envVars,
    id: server._id,
    integrationInstallationId: server.integrationInstallationId,
    managedIntegrationProvider: integrationInstallation?.provider,
    name: server.name,
    serverName: server.serverName,
    startupTimeoutSec: server.startupTimeoutSec,
    toolTimeoutSec: server.toolTimeoutSec,
    transport: server.transport,
    updatedAt: server.updatedAt,
    url: server.url,
    ...(await serverChildren(ctx, server)),
  }
}
