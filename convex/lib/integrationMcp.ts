import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { deleteMcpServerCascade } from "./mcpServerRecords"
import { INTEGRATION_MCP_SERVERS } from "@/lib/integrations/mcp"

function mcpServerEnabled(installation: Doc<"integrationInstallations">) {
  return installation.enabled && installation.mcpEnabled !== false
}

async function availableServerName(
  ctx: MutationCtx,
  installation: Doc<"integrationInstallations">
) {
  const configured = INTEGRATION_MCP_SERVERS[installation.provider]
  const candidates = [
    configured.serverName,
    `cloudcode_${configured.serverName}`,
  ]

  for (const candidate of candidates) {
    const existing = await ctx.db
      .query("mcpServers")
      .withIndex("by_user_server_name", (q) =>
        q.eq("userId", installation.userId).eq("serverName", candidate)
      )
      .unique()
    if (!existing || existing.integrationInstallationId === installation._id) {
      return candidate
    }
  }

  const fallback = `cloudcode_${configured.serverName}_${String(installation._id)}`
  const conflict = await ctx.db
    .query("mcpServers")
    .withIndex("by_user_server_name", (q) =>
      q.eq("userId", installation.userId).eq("serverName", fallback)
    )
    .unique()
  if (conflict) {
    throw new Error(`Unable to reserve an MCP name for ${configured.name}.`)
  }
  return fallback
}

/** Creates or repairs the MCP server managed by one chat integration. The
 * record owns tool policy/discovery only; provider credentials remain in the
 * integration credential plane. */
export async function ensureManagedIntegrationMcpServer(
  ctx: MutationCtx,
  installation: Doc<"integrationInstallations">
) {
  const configured = INTEGRATION_MCP_SERVERS[installation.provider]
  const existing = await ctx.db
    .query("mcpServers")
    .withIndex("by_integration_installation", (q) =>
      q.eq("integrationInstallationId", installation._id)
    )
    .unique()
  const now = Date.now()

  if (existing) {
    const enabled = mcpServerEnabled(installation)
    if (
      existing.description !== configured.description ||
      existing.enabled !== enabled ||
      existing.name !== configured.name ||
      existing.transport !== "http" ||
      existing.url !== configured.url
    ) {
      await ctx.db.patch(existing._id, {
        description: configured.description,
        enabled,
        name: configured.name,
        transport: "http",
        updatedAt: now,
        url: configured.url,
      })
    }
    return existing._id
  }

  return await ctx.db.insert("mcpServers", {
    createdAt: now,
    description: configured.description,
    enabled: mcpServerEnabled(installation),
    integrationInstallationId: installation._id,
    name: configured.name,
    serverName: await availableServerName(ctx, installation),
    transport: "http",
    updatedAt: now,
    url: configured.url,
    userId: installation.userId,
  })
}

export async function ensureManagedIntegrationMcpServersForUser(
  ctx: MutationCtx,
  userId: Id<"users">
) {
  const installations = await ctx.db
    .query("integrationInstallations")
    .withIndex("by_user_provider", (q) => q.eq("userId", userId))
    .collect()
  for (const installation of installations) {
    await ensureManagedIntegrationMcpServer(ctx, installation)
  }
}

export async function deleteManagedIntegrationMcpServer(
  ctx: MutationCtx,
  installationId: Id<"integrationInstallations">
) {
  const server = await ctx.db
    .query("mcpServers")
    .withIndex("by_integration_installation", (q) =>
      q.eq("integrationInstallationId", installationId)
    )
    .unique()
  if (server) await deleteMcpServerCascade(ctx, server._id)
}
