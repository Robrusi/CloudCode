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
