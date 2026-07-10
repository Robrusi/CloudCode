import type { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { finalRunMessageFromContent } from "@/lib/codex/run-log"
import { getWorkerSecret } from "@/lib/codex/run-worker"
import { integrationsConfigured } from "@/lib/integrations/config"
import { dispatchIntegrationRun } from "@/lib/integrations/dispatch"
import {
  postRunFinished,
  postToIntegrationThread,
  recordDeliveryFailure,
  type IntegrationThreadRef,
} from "@/lib/integrations/outbound"

/** Terminal-run seam for the cloudcode-run task: when the finished run's
 * thread is bridged to Slack or Linear, post the outcome there and drain any
 * follow-up messages queued during the run into a continuation run. A no-op
 * for unbridged runs; never throws — the run outcome in Convex is already
 * durable and outbound delivery must not affect it. */
export async function notifyIntegrationRunFinished(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">
) {
  if (!integrationsConfigured()) return

  let threadRef: IntegrationThreadRef | null = null
  try {
    const workerSecret = getWorkerSecret()
    const info = await client.query(api.integrations.workerGetRunNotification, {
      runId,
      workerSecret,
    })
    if (!info) return
    threadRef = info

    const summary = info.content
      ? finalRunMessageFromContent(info.content).trim()
      : undefined
    await postRunFinished(info, { ...info, summary })

    if (info.pendingCount > 0 && info.status === "succeeded") {
      const drained = await client.mutation(
        api.integrations.workerDrainPendingMessages,
        { threadId: info.threadId, workerSecret }
      )
      if (drained) {
        await postToIntegrationThread(
          info,
          "Continuing with the messages that arrived during the run…"
        ).catch(() => undefined)
        await dispatchIntegrationRun(client, drained)
      }
    }
  } catch (error) {
    console.warn("Unable to deliver the integration notification.", error)
    if (threadRef) await recordDeliveryFailure(client, threadRef, error)
  }
}
