import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { requireCodexAuth } from "./codexRunAuth"
import { isBuiltInDefaultPreset } from "./sandboxPresetConstants"

async function mcpServersForRun(
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">
) {
  const servers = await ctx.db
    .query("mcpServers")
    .withIndex("by_user_updated", (q) => q.eq("userId", userId))
    .collect()
  const enabledServers = servers.filter((server) => server.enabled)

  const loadedServers = await Promise.all(
    enabledServers.map(async (server) => {
      const [serverSecrets, serverTools] = await Promise.all([
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
        args: server.args,
        bearerTokenEnvVar: server.bearerTokenEnvVar,
        command: server.command,
        cwd: server.cwd,
        envVars: server.envVars,
        name: server.serverName,
        secrets: serverSecrets
          .map((secret) => ({
            kind: secret.kind,
            name: secret.name,
            value: secret.value,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        startupTimeoutSec: server.startupTimeoutSec,
        toolTimeoutSec: server.toolTimeoutSec,
        tools: serverTools
          .map((tool) => ({
            description: tool.description,
            name: tool.name,
            policy: tool.policy,
            title: tool.title,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        transport: server.transport,
        url: server.url,
      }
    })
  )

  return loadedServers.sort((a, b) => a.name.localeCompare(b.name))
}

export async function workerInputForRun(
  ctx: MutationCtx | QueryCtx,
  run: Doc<"codexRuns">
) {
  const [auth, mcpServers, user] = await Promise.all([
    requireCodexAuth(ctx, run.userId, run.profile),
    mcpServersForRun(ctx, run.userId),
    ctx.db.get(run.userId),
  ])

  let sandboxPreset:
    | {
        daytonaSnapshot?: string
        environmentSlug?: string
        id: Id<"sandboxPresets">
        installScript?: string
        mode?: "manual" | "auto"
        name: string
        pathInstallScript?: string
        secrets: Array<{ name: string; value: string }>
      }
    | undefined
  if (run.sandboxPresetId) {
    const preset = await ctx.db.get(run.sandboxPresetId)
    if (!preset || preset.userId !== run.userId) {
      throw new Error("Preset not found.")
    }
    const isDefaultPreset = isBuiltInDefaultPreset(preset)
    const secrets = isDefaultPreset
      ? []
      : await ctx.db
          .query("sandboxPresetSecrets")
          .withIndex("by_preset", (q) => q.eq("presetId", preset._id))
          .collect()

    sandboxPreset = {
      daytonaSnapshot: isDefaultPreset ? undefined : preset.daytonaSnapshot,
      environmentSlug: preset.environmentSlug,
      id: preset._id,
      installScript: isDefaultPreset ? undefined : preset.installScript,
      mode: preset.mode ?? "manual",
      name: preset.name,
      pathInstallScript: isDefaultPreset ? undefined : preset.pathInstallScript,
      secrets: secrets
        .map((secret) => ({
          name: secret.name,
          value: secret.value,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }

  return {
    agentInstructions: user?.agentInstructions,
    auth,
    canceled: false as const,
    mcpServers,
    run,
    sandboxPreset,
  }
}
