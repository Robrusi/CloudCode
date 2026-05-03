export const SANDBOX_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000
export const SANDBOX_LIFECYCLE = {
  onTimeout: "pause",
  autoResume: true,
} as const

type SandboxTimeoutTarget = {
  setTimeout(timeoutMs: number): Promise<void>
}

export function activeSandboxTimeoutMs(commandTimeoutMs: number) {
  return Math.max(commandTimeoutMs + 60_000, SANDBOX_INACTIVITY_TIMEOUT_MS)
}

export async function refreshSandboxInactivityTimeout(
  sandbox: SandboxTimeoutTarget
) {
  await sandbox.setTimeout(SANDBOX_INACTIVITY_TIMEOUT_MS)
}
