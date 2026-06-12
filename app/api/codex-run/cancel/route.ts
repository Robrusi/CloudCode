import { runs } from "@trigger.dev/sdk"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { syncDiscoveredSandbox } from "@/lib/codex/run-sandbox-sync"
import {
  jsonError,
  jsonStringField,
  readJsonRecord,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const threadId = jsonStringField(body, "threadId")

    if (!threadId) {
      return jsonError("threadId is required.", 400)
    }

    const client = await currentUserConvexHttpClient()
    const canceled = await client.mutation(
      api.codexRuns.cancelActiveForThread,
      {
        threadId: threadId as Id<"threads">,
      }
    )

    const cancelTriggerRun = canceled?.triggerRunId
      ? runs.cancel(canceled.triggerRunId).catch((error) => {
          console.warn("Unable to cancel Trigger.dev run.", error)
        })
      : Promise.resolve()
    const discoverSandbox = canceled?.runId
      ? syncDiscoveredSandbox(client, canceled.runId)
      : Promise.resolve(undefined)
    const [, discoveredSandbox] = await Promise.all([
      cancelTriggerRun,
      discoverSandbox,
    ])

    return NextResponse.json({
      canceled: Boolean(canceled),
      runId: canceled?.runId,
      sandboxId: discoveredSandbox?.sandboxId ?? canceled?.sandboxId,
      triggerRunId: canceled?.triggerRunId,
    })
  } catch (error) {
    console.error("/api/codex-run/cancel failed", error)

    return jsonError(
      error instanceof Error ? error.message : "Unable to cancel run.",
      500
    )
  }
}
