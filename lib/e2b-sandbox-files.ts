import { Sandbox } from "e2b"

import { SANDBOX_LIFECYCLE } from "@/lib/e2b-sandbox-timeout"

const SNAPSHOT_READ_TIMEOUT_MS = 5 * 60 * 1000

export async function withReadableSandbox<T>(
  {
    sandboxId,
    snapshotId,
  }: {
    sandboxId?: string | null
    snapshotId?: string | null
  },
  read: (sandbox: Sandbox, source: "sandbox" | "snapshot") => Promise<T>
) {
  if (sandboxId) {
    try {
      const info = await Sandbox.getInfo(sandboxId)
      if (info.state === "running") {
        return await read(await Sandbox.connect(sandboxId), "sandbox")
      }
    } catch {
      // Fall through to the last snapshot when the live sandbox is gone.
    }
  }

  if (!snapshotId) {
    throw new Error("No running sandbox or snapshot available.")
  }

  const sandbox = await Sandbox.create(snapshotId, {
    lifecycle: SANDBOX_LIFECYCLE,
    timeoutMs: SNAPSHOT_READ_TIMEOUT_MS,
  })
  try {
    return await read(sandbox, "snapshot")
  } finally {
    await sandbox.kill().catch(() => undefined)
  }
}
