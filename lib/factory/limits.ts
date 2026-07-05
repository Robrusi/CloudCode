/**
 * Hard server-side caps for the factory MCP tools. An agent that can spawn
 * billed runs must be bounded in code, not prompt: these are enforced
 * transactionally in the Convex mutations that create dispatched work.
 */

/** A run at depth N may dispatch children at depth N+1 up to this depth.
 * Manually started runs are depth 0. */
export const FACTORY_MAX_SPAWN_DEPTH = 3

/** Queued/running/canceling runs created by run_dispatch or run_message,
 * counted across all of a user's dispatch trees. */
export const FACTORY_MAX_ACTIVE_DISPATCHED_RUNS_PER_USER = 10

/** Lifetime number of runs dispatched under one root thread. */
export const FACTORY_MAX_DISPATCHES_PER_ROOT_THREAD = 200

/** Enabled automations created through automation_create, per user. */
export const FACTORY_MAX_AGENT_CREATED_AUTOMATIONS = 20
