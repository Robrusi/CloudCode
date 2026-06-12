const DEFAULT_WORKER_SECRET_ERROR =
  "Set TRIGGER_WORKER_SECRET before running Trigger tasks."

export function getWorkerSecret(message = DEFAULT_WORKER_SECRET_ERROR) {
  const workerSecret = process.env.TRIGGER_WORKER_SECRET
  if (!workerSecret) throw new Error(message)
  return workerSecret
}
