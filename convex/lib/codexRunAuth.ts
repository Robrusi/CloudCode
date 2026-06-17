import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import {
  codexAuthMissingMessage,
  codexAuthReconnectMessage,
} from "@/lib/codex/auth-errors"

export async function findCodexAuth(
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">,
  profile: string | undefined,
  options?: { fallbackToActive?: boolean }
): Promise<{ auth: Doc<"codexAuth"> | null; profile: string }> {
  const user = options?.fallbackToActive ? await ctx.db.get(userId) : null
  const authProfile =
    profile ??
    (options?.fallbackToActive ? user?.activeCodexProfile : undefined) ??
    "default"
  const auth = await ctx.db
    .query("codexAuth")
    .withIndex("by_user_profile", (q) =>
      q.eq("userId", userId).eq("profile", authProfile)
    )
    .unique()

  return { auth, profile: authProfile }
}

export async function requireCodexAuth(
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">,
  profile: string | undefined,
  options?: { fallbackToActive?: boolean }
) {
  const { auth, profile: authProfile } = await findCodexAuth(
    ctx,
    userId,
    profile,
    options
  )

  if (!auth) {
    throw new Error(codexAuthMissingMessage(authProfile))
  }
  if (auth.invalidatedAt) {
    throw new Error(codexAuthReconnectMessage(authProfile))
  }

  return auth
}
