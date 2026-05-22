import { runs } from "@trigger.dev/sdk"
import { ConvexHttpClient } from "convex/browser"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getConvexAuthToken } from "@/lib/codex-auth"

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

export async function POST(request: Request) {
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

    return NextResponse.json({
      canceled: Boolean(canceled),
      runId: canceled?.runId,
      sandboxId: canceled?.sandboxId,
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
