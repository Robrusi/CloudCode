import type { CachedRunState, LiveRunRecord } from "@/components/chat/types"
import type { SandboxState } from "@/components/chat/sandbox-types"
import type { Id } from "@/convex/_generated/dataModel"

export type ThreadRunStateRef = {
  current: Record<string, CachedRunState>
}

export type SaveThreadRunState = (args: {
  sandboxId: string
  sandboxState: SandboxState
  threadId: Id<"threads">
}) => Promise<unknown>

export function cachedStateFromLiveRun(
  liveRun: LiveRunRecord | null | undefined
): CachedRunState | undefined {
  if (!liveRun) return undefined

  return {
    ...(liveRun.branch ? { branch: liveRun.branch } : {}),
    ...(liveRun.codexThreadId ? { codexThreadId: liveRun.codexThreadId } : {}),
    ...(liveRun.sandboxId ? { sandboxId: liveRun.sandboxId } : {}),
    ...(liveRun.sandboxState ? { sandboxState: liveRun.sandboxState } : {}),
  }
}

export function hasCachedRunKey<K extends keyof CachedRunState>(
  state: CachedRunState | undefined,
  key: K
) {
  return Boolean(state && Object.prototype.hasOwnProperty.call(state, key))
}
