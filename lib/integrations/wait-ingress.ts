import { tasks } from "@trigger.dev/sdk"
import type { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import { getWorkerSecret } from "@/lib/security/worker-secret"
import type {
  FactoryWaitIngressCandidatePayload,
  FactoryWaitIngressPayload,
} from "@/lib/integrations/events"
import type { integrationEvent } from "@/trigger/integrations"

export async function enqueueFactoryWaitIngress(
  client: ConvexHttpClient,
  input: {
    dedupeKey: string
    payload: FactoryWaitIngressCandidatePayload
  }
) {
  const queued = await client.mutation(
    api.factoryWaits.workerEnqueueWaitIngress,
    {
      dedupeKey: input.dedupeKey,
      payloadJson: JSON.stringify(input.payload),
      workerSecret: getWorkerSecret(),
    }
  )
  if (queued.status !== "queued") {
    return { ingressId: queued.ingressId, queued: false }
  }

  await tasks.trigger<typeof integrationEvent>(
    "integration-event",
    {
      ingressId: queued.ingressId,
      kind: "wait_ingress",
    } satisfies FactoryWaitIngressPayload,
    { idempotencyKey: `fwi:${queued.ingressId}` }
  )
  return { ingressId: queued.ingressId, queued: true }
}
