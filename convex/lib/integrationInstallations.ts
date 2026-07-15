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

/** The user's enabled installation of a provider. Multi-workspace users get
 * the earliest-connected one — callers that need a specific workspace should
 * resolve through an installation id instead. */
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
  return installations.find((installation) => installation.enabled) ?? null
}
