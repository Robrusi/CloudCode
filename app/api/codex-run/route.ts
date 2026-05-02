import { NextResponse } from "next/server"

import { getCodexAuthJson, saveCodexAuthJson } from "@/lib/codex-auth"
import {
  type CodexSpeed,
  type ReasoningEffort,
  type RunCodexLog,
  runCodexInSandbox,
} from "@/lib/e2b-codex-agent"

export const runtime = "nodejs"
export const maxDuration = 300

function parseReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (
    value === "none" ||
    value === "minimal" ||
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

function streamEvent(
  controller: ReadableStreamDefaultController,
  value: unknown
) {
  const encoder = new TextEncoder()
  controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      baseBranch?: unknown
      branchName?: unknown
      codexThreadId?: unknown
      githubToken?: unknown
      model?: unknown
      previousDiff?: unknown
      profile?: unknown
      prompt?: unknown
      reasoningEffort?: unknown
      resumeContext?: unknown
      repoUrl?: unknown
      sandboxId?: unknown
      speed?: unknown
      timeoutMs?: unknown
    }

    if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      return NextResponse.json(
        { error: "prompt is required." },
        { status: 400 }
      )
    }

    if (typeof body.repoUrl !== "string" || body.repoUrl.trim().length === 0) {
      return NextResponse.json(
        { error: "repoUrl is required." },
        { status: 400 }
      )
    }

    const prompt = body.prompt
    const repoUrl = body.repoUrl
    const profile = typeof body.profile === "string" ? body.profile : undefined
    const authJson = await getCodexAuthJson(profile)

    const stream = new ReadableStream({
      start(controller) {
        void (async () => {
          try {
            const result = await runCodexInSandbox({
              authJson,
              baseBranch:
                typeof body.baseBranch === "string"
                  ? body.baseBranch
                  : undefined,
              branchName:
                typeof body.branchName === "string"
                  ? body.branchName
                  : undefined,
              codexThreadId:
                typeof body.codexThreadId === "string"
                  ? body.codexThreadId
                  : undefined,
              githubToken:
                typeof body.githubToken === "string"
                  ? body.githubToken
                  : undefined,
              model: typeof body.model === "string" ? body.model : undefined,
              onLog: (log: RunCodexLog) => {
                streamEvent(controller, {
                  log,
                  time: Date.now(),
                  type: "progress",
                })
              },
              previousDiff:
                typeof body.previousDiff === "string"
                  ? body.previousDiff
                  : undefined,
              prompt,
              reasoningEffort: parseReasoningEffort(body.reasoningEffort),
              resumeContext:
                typeof body.resumeContext === "string"
                  ? body.resumeContext
                  : undefined,
              repoUrl,
              sandboxId:
                typeof body.sandboxId === "string" ? body.sandboxId : undefined,
              speed: parseSpeed(body.speed),
              timeoutMs:
                typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
            })
            const { updatedAuthJson, ...responseBody } = result

            if (updatedAuthJson !== authJson) {
              await saveCodexAuthJson(profile, updatedAuthJson)
            }

            streamEvent(controller, {
              result: {
                ...responseBody,
                ok: result.exitCode === 0,
              },
              type: "done",
            })
          } catch (error) {
            console.error("/api/codex-run failed", error)
            streamEvent(controller, {
              error:
                error instanceof Error
                  ? error.message
                  : "Codex sandbox run failed.",
              type: "error",
            })
          } finally {
            controller.close()
          }
        })()
      },
    })

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-transform",
        "content-type": "application/x-ndjson; charset=utf-8",
      },
    })
  } catch (error) {
    console.error("/api/codex-run failed", error)

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Codex sandbox run failed.",
      },
      { status: 500 }
    )
  }
}
