import type { Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { codexAuthReconnectMessage } from "@/lib/codex/auth-errors"

export async function requireCodexAuth(
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">,
  profile: string | undefined,
  options?: { fallbackToActive?: boolean }
) {
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

  if (!auth) {
    throw new Error(
      `No Codex ChatGPT OAuth credentials are stored for profile "${authProfile}".`
    )
  }
  if (auth.invalidatedAt) {
    throw new Error(codexAuthReconnectMessage(authProfile))
  }

  return auth
}
