export type SandboxState = "running" | "stopped" | "deleted" | "error"
export type SandboxAction = "pause" | "resume" | "delete"
export type SandboxActionResult =
  | { ok: true }
  | { message: string; ok: false; status?: number }

export function normalizeSandboxActionState(
  value: unknown,
  fallback: SandboxState
): SandboxState {
  return value === "running" ||
    value === "stopped" ||
    value === "deleted" ||
    value === "error"
    ? value
    : fallback
}
