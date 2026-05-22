export function requireWorkerSecret(workerSecret: string) {
  const expected = process.env.TRIGGER_WORKER_SECRET

  if (!expected) {
    throw new Error("Set TRIGGER_WORKER_SECRET before using worker functions.")
  }

  if (workerSecret !== expected) {
    throw new Error(
      "Unauthorized worker request. Set the same TRIGGER_WORKER_SECRET in Trigger.dev and this Convex deployment."
    )
  }
}
