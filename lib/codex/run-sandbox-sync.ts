import type { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { findDaytonaSandboxInfoForRun } from "@/lib/daytona/sandbox"

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function syncDiscoveredSandbox(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">
) {
  for (const delay of [0, 250, 750, 1_500]) {
    if (delay) await wait(delay)
    const info = await findDaytonaSandboxInfoForRun(runId as string).catch(
      () => null
    )
    if (!info) continue

    await client.mutation(api.codexRuns.syncRunSandbox, {
      runId,
      sandboxId: info.sandboxId,
      sandboxState: info.state,
    })
    return info
  }

  return undefined
}
