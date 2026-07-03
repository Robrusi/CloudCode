import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { requireCodexAuth } from "./codexRunAuth"
import { codexRunInput } from "./codexRunRecords"
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
      const [serverSecrets, serverTools, oauthConnection] = await Promise.all([
        ctx.db
          .query("mcpServerSecrets")
          .withIndex("by_server", (q) => q.eq("serverId", server._id))
          .collect(),
        ctx.db
          .query("mcpServerTools")
          .withIndex("by_server", (q) => q.eq("serverId", server._id))
          .collect(),
        ctx.db
          .query("mcpOauthConnections")
          .withIndex("by_server", (q) => q.eq("serverId", server._id))
          .unique(),
      ])

      // OAuth-managed servers without a token cannot authenticate; exclude
      // them instead of shipping a server that fails every request. Tokens are
      // only attached when the stored URL still matches the authorized one so
      // a later URL edit can never leak the token to another host.
      if (oauthConnection && !oauthConnection.encryptedAccessToken) return null
      const oauth =
        oauthConnection?.encryptedAccessToken &&
        oauthConnection.serverUrl === server.url
          ? {
              clientId: oauthConnection.clientId,
              connectionId: oauthConnection._id,
              encryptedAccessToken: oauthConnection.encryptedAccessToken,
              encryptedClientSecret: oauthConnection.encryptedClientSecret,
              encryptedRefreshToken: oauthConnection.encryptedRefreshToken,
              expiresAt: oauthConnection.expiresAt,
              provider: oauthConnection.provider,
              serverUrl: oauthConnection.serverUrl,
              tokenEndpoint: oauthConnection.tokenEndpoint,
            }
          : undefined

      return {
        oauth,
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

  return loadedServers
    .filter((server) => server !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function workerInputForRun(
  ctx: MutationCtx | QueryCtx,
  run: Doc<"codexRuns">
) {
  const [auth, input, mcpServers, user] = await Promise.all([
    requireCodexAuth(ctx, run.userId, run.profile),
    codexRunInput(ctx, run._id),
    mcpServersForRun(ctx, run.userId),
    ctx.db.get(run.userId),
  ])

  const prompt = input?.prompt ?? run.prompt
  const notesAccessToken = input?.notesAccessToken ?? run.notesAccessToken
  if (!prompt) throw new Error("Codex run is missing its prompt.")
  if (!notesAccessToken) {
    throw new Error("Codex run is missing its notes access token.")
  }

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
    run: {
      ...run,
      githubToken: input?.githubToken ?? run.githubToken,
      imageAttachments: input?.imageAttachments ?? run.imageAttachments,
      notesAccessToken,
      previousDiff: input?.previousDiff ?? run.previousDiff,
      prompt,
      resumeContext: input?.resumeContext ?? run.resumeContext,
    },
    sandboxIdleMinutes: user?.sandboxIdleMinutes,
    sandboxPreset,
  }
}
