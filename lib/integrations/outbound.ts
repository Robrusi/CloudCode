import type { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import { getWorkerSecret } from "@/lib/codex/run-worker"
import {
  getInitializedIntegrationsBot,
  type IntegrationsBot,
} from "@/lib/integrations/bot"
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
export async function withSlackToken<T>(
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

/** Runs a Linear API call with the stored organization installation in
 * scope. Trigger workers run outside the webhook request that normally
 * supplies this context. */
async function withLinearInstallation(
  ref: IntegrationThreadRef,
  fn: (bot: IntegrationsBot["bot"]) => Promise<unknown>
) {
  const instance = await getInitializedIntegrationsBot()
  if (!instance.linear) {
    throw new Error("The Linear integration is not configured.")
  }
  if (!ref.linearOrganizationId) {
    throw new Error("The Linear thread is missing its organization.")
  }
  await instance.linear.withInstallation(ref.linearOrganizationId, () =>
    fn(instance.bot)
  )
}

/** Message metadata event type stamped on factory-authored Slack posts.
 * Reconciliation after an ambiguous post failure finds the already-accepted
 * message by its dedupe key instead of re-posting. */
const FACTORY_POST_METADATA_EVENT = "cloudcode_factory_post"

const SLACK_MESSAGE_ERROR_PREFIX = "Slack rejected the message"

/** Posts a Slack message through the Web API and returns its `ts`, which the
 * Chat SDK's generic post helpers swallow. Waits key their reply/reaction
 * matching on that timestamp, so factory-authored questions go through here
 * rather than postToIntegrationThread. */
export async function postSlackMessage(
  ref: Pick<IntegrationThreadRef, "slackTeamId">,
  message: {
    channel: string
    dedupeKey?: string
    markdown: string
    threadTs?: string
  }
): Promise<{ ts: string }> {
  const { slack } = await getInitializedIntegrationsBot()
  if (!slack) throw new Error("The Slack integration is not configured.")

  return await withSlackToken(
    { externalThreadId: "", provider: "slack", slackTeamId: ref.slackTeamId },
    async () => {
      const response = await slack.webClient.chat.postMessage({
        // The markdown block type postdates the Web API typings.
        blocks: [
          {
            text: message.markdown.slice(0, SLACK_BLOCK_TEXT_MAX),
            type: "markdown",
          },
        ] as never,
        channel: message.channel,
        ...(message.dedupeKey
          ? {
              metadata: {
                event_payload: { dedupeKey: message.dedupeKey },
                event_type: FACTORY_POST_METADATA_EVENT,
              },
            }
          : {}),
        text: message.markdown.slice(0, 2900),
        ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
        unfurl_links: false,
      })
      if (!response.ok || !response.ts) {
        throw new Error(
          `${SLACK_MESSAGE_ERROR_PREFIX}${response.error ? `: ${response.error}` : "."}`
        )
      }
      return { ts: response.ts }
    }
  )
}

/** Slack error codes that can be returned after part of the operation
 * already succeeded (per Slack's chat.postMessage documentation) — the
 * message may exist despite the error, so a blind retry could duplicate
 * it. */
const AMBIGUOUS_SLACK_ERROR_CODES = new Set([
  "fatal_error",
  "internal_error",
  "request_timeout",
  "service_unavailable",
])

function slackRejectionCode(error: unknown): string | undefined {
  const data = (error as { data?: { error?: unknown; ok?: unknown } } | null)
    ?.data
  if (data?.ok === false && typeof data.error === "string") return data.error
  if (
    error instanceof Error &&
    error.message.startsWith(SLACK_MESSAGE_ERROR_PREFIX)
  ) {
    const code = error.message
      .slice(SLACK_MESSAGE_ERROR_PREFIX.length)
      .replace(/^[:.\s]+/, "")
      .trim()
    return code || undefined
  }
  return undefined
}

/** True when Slack definitively rejected the post — the message was not
 * created, so a retry cannot duplicate it. Transport failures (no response)
 * and the error codes Slack documents as possibly-partial are ambiguous:
 * the message may already exist. */
export function isDefiniteSlackRejection(error: unknown) {
  const code = slackRejectionCode(error)
  return Boolean(code && !AMBIGUOUS_SLACK_ERROR_CODES.has(code))
}

const RECONCILE_PAGE_LIMIT = 100
const RECONCILE_MAX_PAGES = 5

/** Looks for a recently posted factory message carrying the dedupe key, to
 * reconcile an ambiguous post failure with what Slack actually accepted.
 * Pages through the range (thread replies arrive oldest-first, so a busy
 * thread can push a fresh message past any single page); `exhausted` tells
 * the caller whether "not found" is a proven absence or just an unfinished
 * search — only a proven absence may justify posting again. */
export async function findSlackMessageByDedupeKey(
  ref: Pick<IntegrationThreadRef, "slackTeamId">,
  query: {
    channel: string
    dedupeKey: string
    oldestTs?: string
    threadTs?: string
  }
): Promise<{ exhausted: boolean; found: { ts: string } | null }> {
  const { slack } = await getInitializedIntegrationsBot()
  if (!slack) throw new Error("The Slack integration is not configured.")

  return await withSlackToken(
    { externalThreadId: "", provider: "slack", slackTeamId: ref.slackTeamId },
    async () => {
      let cursor: string | undefined
      for (let page = 1; page <= RECONCILE_MAX_PAGES; page += 1) {
        const request = {
          channel: query.channel,
          ...(cursor ? { cursor } : {}),
          include_all_metadata: true,
          limit: RECONCILE_PAGE_LIMIT,
          ...(query.oldestTs ? { oldest: query.oldestTs } : {}),
        }
        const response = query.threadTs
          ? await slack.webClient.conversations.replies({
              ...request,
              ts: query.threadTs,
            })
          : await slack.webClient.conversations.history(request)
        const match = (response.messages ?? []).find((candidate) => {
          const metadata = candidate.metadata as
            | { event_payload?: { dedupeKey?: unknown }; event_type?: string }
            | undefined
          return (
            metadata?.event_type === FACTORY_POST_METADATA_EVENT &&
            metadata.event_payload?.dedupeKey === query.dedupeKey
          )
        })
        if (match?.ts) return { exhausted: true, found: { ts: match.ts } }

        cursor = response.response_metadata?.next_cursor || undefined
        if (!response.has_more || !cursor) {
          return { exhausted: true, found: null }
        }
      }
      return { exhausted: false, found: null }
    }
  )
}

/** Removes a factory-authored Slack message (best-effort callers only): used
 * to retract a question whose wait went terminal before it could arm, so an
 * unanswerable prompt does not linger. */
export async function deleteSlackMessage(
  ref: Pick<IntegrationThreadRef, "slackTeamId">,
  message: { channel: string; ts: string }
) {
  const { slack } = await getInitializedIntegrationsBot()
  if (!slack) throw new Error("The Slack integration is not configured.")

  await withSlackToken(
    { externalThreadId: "", provider: "slack", slackTeamId: ref.slackTeamId },
    async () => {
      await slack.webClient.chat.delete({
        channel: message.channel,
        ts: message.ts,
      })
    }
  )
}

/** Posts markdown to an external Slack thread or Linear agent session from
 * outside webhook context (Trigger.dev workers). */
export async function postToIntegrationThread(
  ref: IntegrationThreadRef,
  markdown: string
) {
  if (ref.provider === "linear") {
    await withLinearInstallation(ref, (bot) =>
      bot.thread(ref.externalThreadId).post({ markdown })
    )
    return
  }

  const { bot } = await getInitializedIntegrationsBot()
  const post = () => {
    const { channel, threadTs } = slackThreadParts(ref.externalThreadId)
    return threadTs
      ? bot.thread(ref.externalThreadId).post({ markdown })
      : bot.channel(`slack:${channel}`).post({ markdown })
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

/** Delivers the run-start acknowledgement with provider-native semantics.
 * Linear uses an ephemeral thought so an in-progress run is not marked as a
 * final response; Slack keeps the visible thread reply. */
export async function postRunStarted(
  ref: IntegrationThreadRef,
  threadId: string,
  isFollowUp: boolean
) {
  const markdown = runStartedMessage(threadId, isFollowUp)
  if (ref.provider === "slack") {
    await postToIntegrationThread(ref, markdown)
    return
  }

  await withLinearInstallation(ref, (bot) =>
    bot.thread(ref.externalThreadId).startTyping(markdown)
  )
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
