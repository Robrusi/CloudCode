import { v } from "convex/values"

import { mutation, query } from "./_generated/server"
import { ensureCurrentUser, getCurrentUser } from "./lib/users"

export const store = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    return await ensureCurrentUser(ctx)
  },
})

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    return await getCurrentUser(ctx)
  },
})

export const deleteAccount = mutation({
  args: {},
  returns: v.object({ sandboxIds: v.array(v.string()) }),
  handler: async (ctx) => {
    const userId = await ensureCurrentUser(ctx)
    const [
      codexAuthRows,
      codexRunRows,
      billingCustomerRows,
      billingUsageEventRows,
      billingSandboxSegmentRows,
      sshAccessTokenRows,
      githubAppInstallationRows,
      githubAppUserRows,
      sandboxPresetSecretRows,
      sandboxPresetRows,
      mcpServerRows,
      mcpServerSecretRows,
      mcpServerToolRows,
      sandboxPresetBuildRows,
      sandboxPresetEnvironmentRows,
      threadRows,
    ] = await Promise.all([
      ctx.db
        .query("codexAuth")
        .withIndex("by_user_profile", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("codexRuns")
        .withIndex("by_user_updated", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("billingCustomers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("billingUsageEvents")
        .withIndex("by_user_created", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("billingSandboxSegments")
        .withIndex("by_user_active", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("sshAccessTokens")
        .withIndex("by_user_sandbox", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("githubAppInstallations")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("githubAppUsers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("sandboxPresetSecrets")
        .withIndex("by_user_preset_name", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("sandboxPresets")
        .withIndex("by_user_updated", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("mcpServers")
        .withIndex("by_user_updated", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("mcpServerSecrets")
        .withIndex("by_user_server_name", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("mcpServerTools")
        .withIndex("by_user_server_name", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("sandboxPresetBuilds")
        .withIndex("by_user_updated", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("sandboxPresetEnvironments")
        .withIndex("by_user_updated", (q) => q.eq("userId", userId))
        .collect(),
      ctx.db
        .query("threads")
        .withIndex("by_user_updated", (q) => q.eq("userId", userId))
        .collect(),
    ])

    const messageBatches = await Promise.all(
      threadRows.map((thread) =>
        ctx.db
          .query("messages")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .collect()
      )
    )

    // Daytona sandboxes are external resources; report every id this account
    // ever referenced so the caller can delete them after the data is gone.
    const sandboxIds = new Set<string>()
    for (const thread of threadRows) {
      if (thread.sandboxId) sandboxIds.add(thread.sandboxId)
    }
    for (const run of codexRunRows) {
      if (run.sandboxId) sandboxIds.add(run.sandboxId)
    }
    for (const environment of sandboxPresetEnvironmentRows) {
      if (environment.activeSandboxId)
        sandboxIds.add(environment.activeSandboxId)
    }
    for (const build of sandboxPresetBuildRows) {
      if (build.sandboxId) sandboxIds.add(build.sandboxId)
    }

    const rows = [
      ...codexAuthRows,
      ...codexRunRows,
      ...billingCustomerRows,
      ...billingUsageEventRows,
      ...billingSandboxSegmentRows,
      ...sshAccessTokenRows,
      ...githubAppInstallationRows,
      ...githubAppUserRows,
      ...sandboxPresetSecretRows,
      ...sandboxPresetRows,
      ...mcpServerRows,
      ...mcpServerSecretRows,
      ...mcpServerToolRows,
      ...sandboxPresetBuildRows,
      ...sandboxPresetEnvironmentRows,
      ...threadRows,
      ...messageBatches.flat(),
    ]
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)))
    await ctx.db.delete(userId)

    return { sandboxIds: [...sandboxIds] }
  },
})

export const dismissOnboarding = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await ensureCurrentUser(ctx)
    const user = await ctx.db.get(userId)

    if (user && !user.onboardingDismissedAt) {
      const now = Date.now()
      await ctx.db.patch(userId, {
        onboardingDismissedAt: now,
        updatedAt: now,
      })
    }

    return null
  },
})
