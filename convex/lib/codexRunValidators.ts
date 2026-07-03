import { v } from "convex/values"

export const model = v.union(
  v.literal("gpt-5.5"),
  v.literal("gpt-5.4"),
  v.literal("gpt-5.4-mini")
)

export const speed = v.union(v.literal("standard"), v.literal("fast"))

export const branchMode = v.union(
  v.literal("auto"),
  v.literal("custom"),
  v.literal("base")
)

/** Automation sandbox lifecycle: delete at run end, or keep it idling. */
export const automationSandboxRetention = v.union(
  v.literal("delete"),
  v.literal("idle")
)

/** Automation chat targeting: one shared chat, or a fresh chat per run. */
export const automationThreadMode = v.union(
  v.literal("single"),
  v.literal("per-run")
)

export const thinking = v.union(
  v.literal("none"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("xhigh")
)

export const threadSandboxState = v.union(
  v.literal("running"),
  v.literal("paused"),
  v.literal("killed"),
  v.literal("stopped"),
  v.literal("deleted"),
  v.literal("error")
)

export const workerSandboxState = v.union(
  v.literal("running"),
  v.literal("stopped"),
  v.literal("deleted"),
  v.literal("error")
)

export const runLog = v.object({
  detail: v.optional(v.string()),
  kind: v.union(
    v.literal("setup"),
    v.literal("command"),
    v.literal("reasoning"),
    v.literal("stdout"),
    v.literal("stderr"),
    v.literal("result")
  ),
  message: v.string(),
  time: v.number(),
})

export const messageMeta = v.object({
  branch: v.optional(v.string()),
  diff: v.optional(v.string()),
  logs: v.optional(v.array(runLog)),
  status: v.optional(v.string()),
})

export const imageAttachment = v.object({
  id: v.string(),
  kind: v.literal("image"),
  mimeType: v.string(),
  name: v.string(),
  size: v.number(),
  url: v.string(),
})
