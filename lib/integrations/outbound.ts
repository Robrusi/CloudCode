import { getIntegrationsBot } from "@/lib/integrations/bot"
import { appThreadUrl, slackIntegrationEnv } from "@/lib/integrations/config"

export type IntegrationThreadRef = {
  externalThreadId: string
  linearOrganizationId?: string
  provider: "slack" | "linear"
  slackTeamId?: string
}

/** Posts markdown to an external Slack thread or Linear agent session from
 * outside webhook context (Trigger.dev workers). Both providers need their
 * stored per-workspace installation resolved into scope first when running
 * in OAuth mode; Slack token mode posts with the env token directly. */
export async function postToIntegrationThread(
  ref: IntegrationThreadRef,
  markdown: string
) {
  const { bot, linear, slack } = getIntegrationsBot()
  const post = () => bot.thread(ref.externalThreadId).post({ markdown })

  if (ref.provider === "linear") {
    if (!linear) throw new Error("The Linear integration is not configured.")
    if (!ref.linearOrganizationId) {
      throw new Error("The Linear thread is missing its organization.")
    }
    await linear.withInstallation(ref.linearOrganizationId, post)
    return
  }

  if (slackIntegrationEnv()?.mode === "oauth") {
    if (!slack) throw new Error("The Slack integration is not configured.")
    if (!ref.slackTeamId) {
      throw new Error("The Slack thread is missing its workspace.")
    }
    const installation = await slack.getInstallation(ref.slackTeamId)
    if (!installation) {
      throw new Error("The Slack workspace installation was not found.")
    }
    await slack.withBotToken(installation.botToken, post)
    return
  }

  await post()
}

/** One-line session-started note with the CloudCode deep link. */
export function runStartedMessage(threadId: string, isFollowUp: boolean) {
  const url = appThreadUrl(threadId)
  const action = isFollowUp ? "On it — continuing the session" : "On it"
  return url ? `${action} — [open in CloudCode](${url})` : `${action}.`
}

const SUMMARY_MAX_LENGTH = 1500

/** Completion message for the external thread: status, branch, PR, and the
 * tail of the run's final answer. */
export function runFinishedMessage(run: {
  branchName?: string
  content?: string
  error?: string
  prTitle?: string
  prUrl?: string
  status: string
  summary?: string
  threadId: string
}) {
  const url = appThreadUrl(run.threadId)
  const link = url ? ` — [open in CloudCode](${url})` : ""

  if (run.status === "canceled") return `⏹️ Run canceled${link}`
  if (run.status !== "succeeded") {
    const reason = run.error ? `: ${run.error}` : "."
    return `❌ Run failed${reason}${link}`
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
  if (run.branchName) details.push(`branch \`${run.branchName}\``)
  if (run.prUrl) {
    details.push(`PR: [${run.prTitle ?? run.prUrl}](${run.prUrl})`)
  }
  lines.push(
    `✅ Done${details.length ? ` — ${details.join(", ")}` : ""}${link}`
  )
  return lines.join("\n")
}
