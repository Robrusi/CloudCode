import { runs } from "@trigger.dev/sdk"
import { ConvexHttpClient } from "convex/browser"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getConvexAuthToken } from "@/lib/codex-auth"
import { findDaytonaSandboxInfoForRun } from "@/lib/daytona-sandbox"
import { requireSameOrigin } from "@/lib/request-security"

export const runtime = "nodejs"

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL

  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before using Convex storage.")
  }

  return url
}

async function convexClient() {
  const client = new ConvexHttpClient(getConvexUrl())
  client.setAuth(await getConvexAuthToken())
  return client
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function syncDiscoveredSandbox(
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

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = (await request.json()) as {
      threadId?: unknown
    }

    if (typeof body.threadId !== "string" || !body.threadId.trim()) {
      return NextResponse.json(
        { error: "threadId is required." },
        { status: 400 }
      )
    }

    const client = await convexClient()
    const canceled = await client.mutation(
      api.codexRuns.cancelActiveForThread,
      {
        threadId: body.threadId as Id<"threads">,
      }
    )

    if (canceled?.triggerRunId) {
      await runs.cancel(canceled.triggerRunId).catch((error) => {
        console.warn("Unable to cancel Trigger.dev run.", error)
      })
    }
    const discoveredSandbox = canceled?.runId
      ? await syncDiscoveredSandbox(client, canceled.runId)
      : undefined

    return NextResponse.json({
      canceled: Boolean(canceled),
      runId: canceled?.runId,
      sandboxId: discoveredSandbox?.sandboxId ?? canceled?.sandboxId,
      triggerRunId: canceled?.triggerRunId,
    })
  } catch (error) {
    console.error("/api/codex-run/cancel failed", error)

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to cancel run.",
      },
      { status: 500 }
    )
  }
}
