import { runs, tasks } from "@trigger.dev/sdk"
import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { parseBranchMode } from "@/lib/codex/branch-names"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { syncDiscoveredSandbox } from "@/lib/codex/run-sandbox-sync"
import { parseChatImageAttachments } from "@/lib/chat/attachments"
import {
  CODEX_REASONING_EFFORT_ERROR,
  CODEX_SPEED_ERROR,
  parseCodexReasoningEffort,
  parseCodexSpeed,
} from "@/lib/codex/run-options"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github/auth"
import { canClonePublicGitHubRepo } from "@/lib/github/repo-api"
import {
  jsonError,
  jsonRawStringField,
  readJsonRecord,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import { encryptSecret } from "@/lib/security/secret-crypto"
import { getWorkerSecret } from "@/lib/security/worker-secret"
import type { cloudcodeRun } from "@/trigger/cloudcode-run"

export const runtime = "nodejs"

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`)
  }

  return value
}

const QUEUE_WORKER_SECRET_ERROR =
  "Set TRIGGER_WORKER_SECRET before queueing Codex runs."

const CODEX_RUN_CREATE_ERROR_STATUS = {
  auth_reconnect_required: 401,
  missing_auth: 401,
  thread_busy: 409,
} as const

function createRunErrorStatus(
  status: keyof typeof CODEX_RUN_CREATE_ERROR_STATUS
) {
  return CODEX_RUN_CREATE_ERROR_STATUS[status]
}

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  let runId: Id<"codexRuns"> | undefined

  try {
    const body = await readJsonRecord(request)

    const prompt = requiredString(body.prompt, "prompt")
    const repoUrl = requiredString(body.repoUrl, "repoUrl")
    const threadId = requiredString(body.threadId, "threadId") as Id<"threads">
    const assistantMessageId = requiredString(
      body.assistantMessageId,
      "assistantMessageId"
    ) as Id<"messages">
    const model = requiredString(body.model, "model")
    const reasoningEffort = parseCodexReasoningEffort(body.reasoningEffort)
    const speed = parseCodexSpeed(body.speed)
    const imageAttachments = parseChatImageAttachments(body.imageAttachments)

    if (!reasoningEffort) {
      return jsonError(CODEX_REASONING_EFFORT_ERROR, 400)
    }
    if (!speed) {
      return jsonError(CODEX_SPEED_ERROR, 400)
    }

    const [githubCredential, client] = await Promise.all([
      maybeGetCurrentGitHubRepoCredential(repoUrl),
      currentUserConvexHttpClient(),
    ])
    const publicRepoCloneAllowed =
      !githubCredential?.token && (await canClonePublicGitHubRepo(repoUrl))
    if (!githubCredential?.token && !publicRepoCloneAllowed) {
      return jsonError(
        "Install the GitHub App on this repository and authorize your GitHub user, or use a public GitHub repository.",
        401
      )
    }

    const billing = await client.action(
      api.billing.checkCurrentUserInfraAccess,
      {}
    )
    if (!billing.allowed) {
      return jsonError(
        "Upgrade to Hobby or Plus, or wait for your included usage to reset.",
        402
      )
    }

    const encryptedGitHubToken = githubCredential?.token
      ? encryptSecret(githubCredential.token)
      : undefined
    const created = await client.mutation(api.codexRuns.create, {
      assistantMessageId,
      baseBranch: jsonRawStringField(body, "baseBranch"),
      branchMode: parseBranchMode(body.branchMode),
      branchName: jsonRawStringField(body, "branchName"),
      codexThreadId: jsonRawStringField(body, "codexThreadId"),
      githubToken: encryptedGitHubToken,
      githubUserEmail: githubCredential?.gitUserEmail,
      githubUserName: githubCredential?.gitUserName,
      githubUsername: githubCredential?.username ?? undefined,
      imageAttachments: imageAttachments.length ? imageAttachments : undefined,
      model: model as "gpt-5.5" | "gpt-5.4" | "gpt-5.4-mini",
      notesAccessToken: randomUUID(),
      previousDiff: jsonRawStringField(body, "previousDiff"),
      profile: jsonRawStringField(body, "profile"),
      prompt,
      reasoningEffort,
      repoUrl,
      resumeContext: jsonRawStringField(body, "resumeContext"),
      sandboxId: jsonRawStringField(body, "sandboxId"),
      sandboxPresetId: jsonRawStringField(body, "sandboxPresetId") as
        | Id<"sandboxPresets">
        | undefined,
      speed,
      threadId,
      workerSecret: getWorkerSecret(QUEUE_WORKER_SECRET_ERROR),
    })
    if (!created.ok) {
      return jsonError(
        created.message,
        createRunErrorStatus(created.status),
        "profile" in created ? { profile: created.profile } : undefined
      )
    }
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
      await currentUserConvexHttpClient()
        .then((client) =>
          client.mutation(api.codexRuns.failBeforeStart, {
            error:
              error instanceof Error ? error.message : "Unable to queue run.",
            runId: failedRunId,
          })
        )
        .catch(() => undefined)
    }

    return jsonError(
      error instanceof Error ? error.message : "Unable to queue run.",
      500
    )
  }
}
