import { tasks } from "@trigger.dev/sdk"

import type { Id } from "@/convex/_generated/dataModel"
import type { factoryDispatch } from "@/trigger/factory"

export type FactoryWakeRunRef = {
  runId: Id<"codexRuns">
  threadId: Id<"threads">
  userId: Id<"users">
}

/** Factory wake-up runs created by Convex mutations (terminal-status hooks,
 * wait events, the expiry sweep) sit queued until a factory-dispatch task
 * picks them up; queue one per created run. Failures are logged, not thrown:
 * factory-dispatch's idempotency key makes redelivery safe, and for
 * wait-event wakes the tick's workerRecoverWakeDispatches backstop finds
 * runs still queued with no Trigger run attached and re-enqueues them. */
export async function queueFactoryWakeRuns(wakeRuns?: FactoryWakeRunRef[]) {
  for (const wake of wakeRuns ?? []) {
    await tasks
      .trigger<typeof factoryDispatch>(
        "factory-dispatch",
        { runId: wake.runId },
        {
          idempotencyKey: `factory-dispatch:${wake.runId}`,
          tags: [`user:${wake.userId}`, `thread:${wake.threadId}`],
        }
      )
      .catch((error) => {
        console.warn("Unable to queue factory wake-up run.", error)
      })
  }
}
