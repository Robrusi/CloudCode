import { runs, tasks } from "@trigger.dev/sdk"
import { ConvexHttpClient } from "convex/browser"
import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { parseBranchMode } from "@/lib/codex-branch-names"
import { getConvexAuthToken } from "@/lib/codex-auth"
import { syncDiscoveredSandbox } from "@/lib/codex-run-sandbox-sync"
import { parseChatImageAttachments } from "@/lib/chat-attachments"
import type { CodexSpeed, ReasoningEffort } from "@/lib/daytona-codex-agent"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github-auth"
import { canClonePublicGitHubRepo } from "@/lib/github-repo-api"
import { requireSameOrigin } from "@/lib/request-security"
import { encryptSecret } from "@/lib/secret-crypto"
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
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  let runId: Id<"codexRuns"> | undefined

  try {
    const body = (await request.json()) as {
      assistantMessageId?: unknown
      baseBranch?: unknown
      branchMode?: unknown
      branchName?: unknown
      codexThreadId?: unknown
      imageAttachments?: unknown
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
    const imageAttachments = parseChatImageAttachments(body.imageAttachments)

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

    const [githubCredential, client] = await Promise.all([
      maybeGetCurrentGitHubRepoCredential(repoUrl),
      convexClient(),
    ])
    const publicRepoCloneAllowed =
      !githubCredential?.token && (await canClonePublicGitHubRepo(repoUrl))
    if (!githubCredential?.token && !publicRepoCloneAllowed) {
      return NextResponse.json(
        {
          error:
            "Install the GitHub App on this repository and authorize your GitHub user, or use a public GitHub repository.",
        },
        { status: 401 }
      )
    }

    const billing = await client.action(
      api.billing.checkCurrentUserInfraAccess,
      {}
    )
    if (!billing.allowed) {
      return NextResponse.json(
        {
          error:
            "Upgrade to Hobby or Plus, or wait for your included usage to reset.",
        },
        { status: 402 }
      )
    }

    const encryptedGitHubToken = githubCredential?.token
      ? encryptSecret(githubCredential.token)
      : undefined
    const created = await client.mutation(api.codexRuns.create, {
      assistantMessageId,
      baseBranch:
        typeof body.baseBranch === "string" ? body.baseBranch : undefined,
      branchMode: parseBranchMode(body.branchMode),
      branchName:
        typeof body.branchName === "string" ? body.branchName : undefined,
      codexThreadId:
        typeof body.codexThreadId === "string" ? body.codexThreadId : undefined,
      githubToken: encryptedGitHubToken,
      githubUserEmail: githubCredential?.gitUserEmail,
      githubUserName: githubCredential?.gitUserName,
      githubUsername: githubCredential?.username ?? undefined,
      imageAttachments: imageAttachments.length ? imageAttachments : undefined,
      model: model as "gpt-5.5" | "gpt-5.4" | "gpt-5.4-mini",
      notesAccessToken: randomUUID(),
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
    const createdRunId = created.runId
    runId = createdRunId

    const handle = await tasks.trigger<typeof cloudcodeRun>(
      "cloudcode-run",
      { runId: createdRunId },
      {
        idempotencyKey: createdRunId,
        tags: [`user:${created.userId}`, `thread:${threadId}`],
      }
    )

    const attached = await client.mutation(api.codexRuns.attachTriggerRun, {
      runId: createdRunId,
      triggerRunId: handle.id,
    })
    if (attached.canceled) {
      // The run was canceled in the small window between creation and trigger id
      // attachment. Cancel the queued Trigger run too so it cannot wake up later.
      await runs.cancel(handle.id).catch((error) => {
        console.warn("Unable to cancel queued Trigger.dev run.", error)
      })
      const sandbox = await syncDiscoveredSandbox(client, createdRunId)
      await client.mutation(api.codexRuns.finishQueuedCancel, {
        runId: createdRunId,
        sandboxId: sandbox?.sandboxId,
        sandboxState: sandbox?.state,
        triggerRunId: handle.id,
      })
      return NextResponse.json({ runId: createdRunId, triggerRunId: handle.id })
    }

    return NextResponse.json({ runId: createdRunId, triggerRunId: handle.id })
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
