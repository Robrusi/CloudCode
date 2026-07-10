import type { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import { getWorkerSecret } from "@/lib/codex/run-worker"
import { getInitializedIntegrationsBot } from "@/lib/integrations/bot"
import { appThreadUrl, slackIntegrationEnv } from "@/lib/integrations/config"
import { slackThreadParts } from "@/lib/integrations/slack-threads"

export type IntegrationThreadRef = {
  externalThreadId: string
  linearOrganizationId?: string
  provider: "slack" | "linear"
  slackTeamId?: string
}

/** Runs a Slack API call with the right bot token in scope: the stored
 * workspace installation in OAuth mode, or the env token in token mode. */
async function withSlackToken<T>(
  ref: IntegrationThreadRef,
  fn: () => Promise<T>
): Promise<T> {
  const { slack } = await getInitializedIntegrationsBot()
  if (!slack) throw new Error("The Slack integration is not configured.")

  if (slackIntegrationEnv()?.mode === "oauth") {
    if (!ref.slackTeamId) {
      throw new Error("The Slack thread is missing its workspace.")
    }
    const installation = await slack.getInstallation(ref.slackTeamId)
    if (!installation) {
      throw new Error("The Slack workspace installation was not found.")
    }
    return await slack.withBotToken(installation.botToken, fn)
  }

  return await fn()
}

/** Posts markdown to an external Slack thread or Linear agent session from
 * outside webhook context (Trigger.dev workers). */
export async function postToIntegrationThread(
  ref: IntegrationThreadRef,
  markdown: string
) {
  const { bot, linear } = await getInitializedIntegrationsBot()
  const post = () => {
    if (ref.provider === "slack") {
      const { channel, threadTs } = slackThreadParts(ref.externalThreadId)
      if (!threadTs) return bot.channel(`slack:${channel}`).post({ markdown })
    }
    return bot.thread(ref.externalThreadId).post({ markdown })
  }

  if (ref.provider === "linear") {
    if (!linear) throw new Error("The Linear integration is not configured.")
    if (!ref.linearOrganizationId) {
      throw new Error("The Linear thread is missing its organization.")
    }
    await linear.withInstallation(ref.linearOrganizationId, post)
    return
  }

  await withSlackToken(ref, post)
}

/** Persists an outbound delivery failure on the thread's bridge row so it is
 * visible outside the worker logs. Best-effort itself — never throws. */
export async function recordDeliveryFailure(
  client: ConvexHttpClient,
  ref: IntegrationThreadRef,
  error: unknown
) {
  const message =
    error instanceof Error
      ? [error.message, ...(error.stack?.split("\n").slice(1, 4) ?? [])].join(
          "\n"
        )
      : String(error)
  await client
    .mutation(api.integrations.workerRecordDeliveryFailure, {
      error: message,
      externalThreadId: ref.externalThreadId,
      provider: ref.provider,
      workerSecret: getWorkerSecret(),
    })
    .catch(() => undefined)
}

/** One-line session-started note with the CloudCode deep link. */
export function runStartedMessage(threadId: string, isFollowUp: boolean) {
  const url = appThreadUrl(threadId)
  const action = isFollowUp ? "On it — continuing the session" : "On it"
  return url ? `${action} — [open in CloudCode](${url})` : `${action}.`
}

// Slack renders markdown_text up to 12k characters; leave room for the
// status line and link so the agent's actual answer is what gets read.
const SUMMARY_MAX_LENGTH = 6000

/** "owner/name" for the details line; falls back to the raw URL host-less
 * form when the repo is not a canonical GitHub URL. */
function repoLabelOf(repoUrl: string | undefined) {
  if (!repoUrl) return undefined
  const match = repoUrl.match(
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i
  )
  return match ? `${match[1]}/${match[2]}` : repoUrl
}

type RunFinishedInfo = {
  branchName?: string
  content?: string
  error?: string
  prTitle?: string
  prUrl?: string
  repoUrl?: string
  status: string
  summary?: string
  threadId: string
}

/** Completion body: the run's final answer, then status with repo, branch,
 * and PR — without the thread link, which each surface attaches its own way
 * (Slack: button; Linear and fallbacks: inline markdown link). */
function runFinishedBody(run: RunFinishedInfo) {
  if (run.status === "canceled") return "⏹️ Run canceled"
  if (run.status !== "succeeded") {
    return `❌ Run failed${run.error ? `: ${run.error}` : "."}`
  }

  const lines: string[] = []
  const summary = run.summary?.trim()
  if (summary) {
    lines.push(
      summary.length > SUMMARY_MAX_LENGTH
        ? `${summary.slice(0, SUMMARY_MAX_LENGTH)}…`
        : summary
    )
    lines.push("")
  }
  const details: string[] = []
  const repoLabel = repoLabelOf(run.repoUrl)
  if (repoLabel) details.push(`repo \`${repoLabel}\``)
  if (run.branchName) details.push(`branch \`${run.branchName}\``)
  if (run.prUrl) {
    details.push(`PR: [${run.prTitle ?? run.prUrl}](${run.prUrl})`)
  }
  lines.push(`✅ Done${details.length ? ` — ${details.join(", ")}` : ""}`)
  return lines.join("\n")
}

export function runFinishedMessage(run: RunFinishedInfo) {
  const url = appThreadUrl(run.threadId)
  return `${runFinishedBody(run)}${url ? ` — [open in CloudCode](${url})` : ""}`
}

// Slack's markdown block caps at 12k characters.
const SLACK_BLOCK_TEXT_MAX = 11500

/** Slack-native completion post: the body as a markdown block plus an
 * "Open in CloudCode" button. Buttons need Block Kit, which the generic
 * markdown post cannot carry. */
async function postSlackRunFinished(
  ref: IntegrationThreadRef,
  body: string,
  threadUrl: string
) {
  const { slack } = await getInitializedIntegrationsBot()
  if (!slack) throw new Error("The Slack integration is not configured.")

  await withSlackToken(ref, async () => {
    // Timestamped ids post threaded; legacy DM bridges post top-level.
    const { channel, threadTs } = slackThreadParts(ref.externalThreadId)
    const blocks = [
      { text: body.slice(0, SLACK_BLOCK_TEXT_MAX), type: "markdown" },
      {
        elements: [
          {
            text: {
              emoji: true,
              text: "Open in CloudCode",
              type: "plain_text",
            },
            type: "button",
            url: threadUrl,
          },
        ],
        type: "actions",
      },
    ]
    await slack.webClient.chat.postMessage({
      // The markdown block type postdates the Web API typings.
      blocks: blocks as never,
      channel,
      text: body.slice(0, 2900),
      ...(threadTs ? { thread_ts: threadTs } : {}),
      unfurl_links: false,
    })
  })
}

/** Posts the completion message: Slack gets Block Kit with a thread button,
 * Linear (and any Slack Block Kit failure) gets markdown with an inline
 * link. Throws only when every attempt failed. */
export async function postRunFinished(
  ref: IntegrationThreadRef,
  run: RunFinishedInfo
) {
  const url = appThreadUrl(run.threadId)
  if (ref.provider === "slack" && url) {
    try {
      await postSlackRunFinished(ref, runFinishedBody(run), url)
      return
    } catch (error) {
      console.warn(
        "Slack Block Kit completion post failed; falling back to markdown.",
        error
      )
    }
  }

  await postToIntegrationThread(ref, runFinishedMessage(run))
}
