import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

export async function installationForProviderExternal(
  ctx: QueryCtx | MutationCtx,
  provider: Doc<"integrationInstallations">["provider"],
  externalId: string
) {
  return await ctx.db
    .query("integrationInstallations")
    .withIndex("by_provider_external", (q) =>
      q.eq("provider", provider).eq("externalId", externalId)
    )
    .first()
}

/** The user's single enabled installation of a provider. Ambiguity is an
 * error, not a guess: with several enabled workspaces a silent first-match
 * would post questions to (or watch issues in) the wrong one. Callers with a
 * concrete workspace in hand (thread bridges, webhook events) resolve
 * through the installation id instead and are unaffected. */
export async function enabledInstallationForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  provider: Doc<"integrationInstallations">["provider"]
) {
  const installations = await ctx.db
    .query("integrationInstallations")
    .withIndex("by_user_provider", (q) =>
      q.eq("userId", userId).eq("provider", provider)
    )
    .collect()
  const enabled = installations.filter((installation) => installation.enabled)
  if (enabled.length > 1) {
    throw new Error(
      `Multiple ${provider} workspaces are connected, so the target workspace is ambiguous. Waits and posts currently support one enabled ${provider} workspace; disable the others in Settings → Connections, or start the session from the intended workspace's conversation.`
    )
  }
  return enabled[0] ?? null
}
