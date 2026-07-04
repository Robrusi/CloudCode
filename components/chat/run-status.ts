/** Display helpers for codexRuns statuses shared by run-history lists
 * (automations, reviews). */

export type RunStatus =
  | "queued"
  | "running"
  | "canceling"
  | "succeeded"
  | "failed"
  | "canceled"

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  canceled: "Canceled",
  canceling: "Canceling",
  failed: "Failed",
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
}

export function runDotClass(status: RunStatus) {
  switch (status) {
    case "succeeded":
      return "bg-success"
    case "failed":
      return "bg-destructive"
    case "canceled":
      return "bg-muted-foreground/50"
    default:
      return "animate-pulse bg-foreground"
  }
}
