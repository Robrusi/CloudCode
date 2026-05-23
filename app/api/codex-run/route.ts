import { runs, tasks } from "@trigger.dev/sdk"
import { ConvexHttpClient } from "convex/browser"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getConvexAuthToken } from "@/lib/codex-auth"
import type { CodexSpeed, ReasoningEffort } from "@/lib/daytona-codex-agent"
import type { cloudcodeRun } from "@/trigger/cloudcode-run"

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

function parseReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (
    value === "none" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value
  }

  return undefined
}

function parseSpeed(value: unknown): CodexSpeed | undefined {
  if (value === "standard" || value === "fast") {
    return value
  }

  return undefined
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`)
  }

  return value
}

function getWorkerSecret() {
  const workerSecret = process.env.TRIGGER_WORKER_SECRET

  if (!workerSecret) {
    throw new Error("Set TRIGGER_WORKER_SECRET before queueing Codex runs.")
  }

  return workerSecret
}

export async function POST(request: Request) {
  let runId: Id<"codexRuns"> | undefined

  try {
    const body = (await request.json()) as {
      assistantMessageId?: unknown
      baseBranch?: unknown
      branchName?: unknown
      codexThreadId?: unknown
      model?: unknown
      previousDiff?: unknown
      profile?: unknown
      prompt?: unknown
      reasoningEffort?: unknown
      resumeContext?: unknown
      repoUrl?: unknown
      sandboxId?: unknown
      sandboxPresetId?: unknown
      speed?: unknown
      threadId?: unknown
    }

    const prompt = requiredString(body.prompt, "prompt")
    const repoUrl = requiredString(body.repoUrl, "repoUrl")
    const threadId = requiredString(body.threadId, "threadId") as Id<"threads">
    const assistantMessageId = requiredString(
      body.assistantMessageId,
      "assistantMessageId"
    ) as Id<"messages">
    const model = requiredString(body.model, "model")
    const reasoningEffort = parseReasoningEffort(body.reasoningEffort)
    const speed = parseSpeed(body.speed)

    if (!reasoningEffort) {
      return NextResponse.json(
        { error: "reasoningEffort must be none, low, medium, high, or xhigh." },
        { status: 400 }
      )
    }
    if (!speed) {
      return NextResponse.json(
        { error: "speed must be standard or fast." },
        { status: 400 }
      )
    }

    const client = await convexClient()
    const created = await client.mutation(api.codexRuns.create, {
      assistantMessageId,
      baseBranch:
        typeof body.baseBranch === "string" ? body.baseBranch : undefined,
      branchName:
        typeof body.branchName === "string" ? body.branchName : undefined,
      codexThreadId:
        typeof body.codexThreadId === "string" ? body.codexThreadId : undefined,
      model: model as "gpt-5.5" | "gpt-5.4" | "gpt-5.4-mini",
      previousDiff:
        typeof body.previousDiff === "string" ? body.previousDiff : undefined,
      profile: typeof body.profile === "string" ? body.profile : undefined,
      prompt,
      reasoningEffort,
      repoUrl,
      resumeContext:
        typeof body.resumeContext === "string" ? body.resumeContext : undefined,
      sandboxId:
        typeof body.sandboxId === "string" ? body.sandboxId : undefined,
      sandboxPresetId:
        typeof body.sandboxPresetId === "string"
          ? (body.sandboxPresetId as Id<"sandboxPresets">)
          : undefined,
      speed,
      threadId,
      workerSecret: getWorkerSecret(),
    })
    runId = created.runId

    const handle = await tasks.trigger<typeof cloudcodeRun>(
      "cloudcode-run",
      { runId },
      {
        idempotencyKey: runId,
        tags: [`user:${created.userId}`, `thread:${threadId}`],
      }
    )

    const attached = await client.mutation(api.codexRuns.attachTriggerRun, {
      runId,
      triggerRunId: handle.id,
    })
    if (attached.canceled) {
      // The run was canceled in the small window between creation and trigger id
      // attachment. Cancel the queued Trigger run too so it cannot wake up later.
      await runs.cancel(handle.id).catch((error) => {
        console.warn("Unable to cancel canceled Trigger.dev run.", error)
      })
      return NextResponse.json({ runId, triggerRunId: handle.id })
    }

    return NextResponse.json({ runId, triggerRunId: handle.id })
  } catch (error) {
    console.error("/api/codex-run failed", error)
    if (runId) {
      const failedRunId = runId
      await convexClient()
        .then((client) =>
          client.mutation(api.codexRuns.failBeforeStart, {
            error:
              error instanceof Error ? error.message : "Unable to queue run.",
            runId: failedRunId,
          })
        )
        .catch(() => undefined)
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to queue run.",
      },
      { status: 500 }
    )
  }
}
