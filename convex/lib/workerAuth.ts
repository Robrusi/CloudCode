export function requireWorkerSecret(workerSecret: string) {
  if (workerSecret !== workerSecretFromEnv()) {
    throw new Error(
      "Unauthorized worker request. Set the same TRIGGER_WORKER_SECRET in Trigger.dev and this Convex deployment."
    )
  }
}

/** The deployment's own worker secret, for Convex actions that call
 * worker-authenticated functions on behalf of a validated caller. */
export function workerSecretFromEnv() {
  const expected = process.env.TRIGGER_WORKER_SECRET

  if (!expected) {
    throw new Error("Set TRIGGER_WORKER_SECRET before using worker functions.")
  }

  return expected
}
