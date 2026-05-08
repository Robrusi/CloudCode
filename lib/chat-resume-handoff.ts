import { getDiffStats } from "./diff-metadata"

type Role = "user" | "assistant"

type HandoffMessage = {
  content: string
  id?: unknown
  pending?: boolean
  role: Role
}

const HANDOFF_CONTENT_LIMIT = 1_200
const HANDOFF_RECENT_USER_LIMIT = 4
const HANDOFF_DIFF_FILE_LIMIT = 12

function truncateHandoffContent(
  content: string,
  limit = HANDOFF_CONTENT_LIMIT
) {
  const trimmed = content.trim()

  if (trimmed.length <= limit) {
    return trimmed
  }

  return `${trimmed.slice(0, limit)}\n[truncated]`
}

function latestCompletedMessage(messages: HandoffMessage[], role: Role) {
  return messages
    .toReversed()
    .find((message) => message.role === role && !message.pending)
}

function buildDiffSummary(diff?: string) {
  if (!diff?.trim()) {
    return "No saved diff was available."
  }

  const stats = getDiffStats(diff)

  if (stats.files.length === 0) {
    return "Saved diff is empty."
  }

  const fileLines = stats.files
    .slice(0, HANDOFF_DIFF_FILE_LIMIT)
    .map((file) => `- ${file.path} (+${file.additions}/-${file.deletions})`)
  const remaining = stats.files.length - fileLines.length

  return [
    `${stats.files.length} file${stats.files.length === 1 ? "" : "s"} changed, +${stats.additions}/-${stats.deletions}.`,
    ...fileLines,
    remaining > 0
      ? `- ${remaining} more file${remaining === 1 ? "" : "s"}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
}

export function buildResumeHandoff({
  branchName,
  messages,
  previousDiff,
  repoUrl,
  status,
}: {
  branchName?: string
  messages: HandoffMessage[]
  previousDiff?: string
  repoUrl: string
  status?: string
}) {
  const completedMessages = messages.filter(
    (message) => !message.pending && message.content.trim()
  )

  if (
    completedMessages.length === 0 &&
    !branchName &&
    !previousDiff?.trim() &&
    !status?.trim()
  ) {
    return undefined
  }

  const originalGoal = completedMessages.find(
    (message) => message.role === "user"
  )
  const lastAssistant = latestCompletedMessage(messages, "assistant")
  const recentUserClarifications = completedMessages
    .filter(
      (message) => message.role === "user" && message.id !== originalGoal?.id
    )
    .slice(-HANDOFF_RECENT_USER_LIMIT)

  return [
    "Previous Cloudcode thread handoff:",
    `Original goal:\n${originalGoal ? truncateHandoffContent(originalGoal.content) : "Unknown."}`,
    `Repo:\n${repoUrl}`,
    `Branch:\n${branchName ?? "Unknown."}`,
    `Restored changes:\n${buildDiffSummary(previousDiff)}`,
    status?.trim()
      ? `Last git status:\n${truncateHandoffContent(status, 1_500)}`
      : "",
    lastAssistant
      ? `Last assistant result:\n${truncateHandoffContent(lastAssistant.content)}`
      : "",
    recentUserClarifications.length > 0
      ? [
          "Recent user clarifications:",
          ...recentUserClarifications.map(
            (message) => `- ${truncateHandoffContent(message.content, 600)}`
          ),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}
