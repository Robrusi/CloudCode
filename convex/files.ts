import { v } from "convex/values"

import { mutation } from "./_generated/server"
import { ensureCurrentUser } from "./lib/users"

// Issue a short-lived upload URL for the client to POST an image to. Convex
// hosts the file at a public URL that GitHub (and the app) can render.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await ensureCurrentUser(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

// Resolve a stored file to its public URL after upload completes.
export const getUploadedUrl = mutation({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ensureCurrentUser(ctx)
    return await ctx.storage.getUrl(args.storageId)
  },
})
