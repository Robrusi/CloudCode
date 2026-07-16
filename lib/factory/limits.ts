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

/** Arming/armed waits registered through ask_human or wait_create, per
 * thread and across all of a user's threads. */
export const FACTORY_MAX_ACTIVE_WAITS_PER_THREAD = 10
export const FACTORY_MAX_ACTIVE_WAITS_PER_USER = 100

/** Queued (not yet reported) events one wait may accumulate while its
 * thread is busy. */
export const FACTORY_MAX_PENDING_EVENTS_PER_WAIT = 25

/** Sliding-window cap on events one wait may record, so a busy PR or
 * channel cannot flood the wake queue. */
export const FACTORY_WAIT_EVENT_WINDOW_MS = 60 * 60_000
export const FACTORY_WAIT_EVENT_WINDOW_MAX = 10

/** Wait TTLs: every wait expires and wakes its thread with a timeout event,
 * so no wait outlives usefulness or dies silently. */
export const FACTORY_WAIT_MIN_TTL_MS = 5 * 60_000
export const FACTORY_WAIT_DEFAULT_TTL_MS = 7 * 24 * 60 * 60_000
export const FACTORY_WAIT_MAX_TTL_MS = 14 * 24 * 60 * 60_000
