import { LINEAR_COMMENT_AUTHOR_FILTER_MAX } from "@/lib/automations/linear-comment-trigger"
import {
  GITHUB_FACTORY_WAIT_EVENTS,
  LINEAR_INTEGRATION_EVENTS,
  type GitHubFactoryWaitTrigger,
  type LinearIntegrationTrigger,
} from "@/convex/lib/integrationTriggers"

export const FACTORY_WAIT_KINDS = [
  "slack_thread",
  "github_pr",
  "github_event",
  "linear_issue",
  "linear_event",
  "sentry_event",
  "datadog_event",
  "pagerduty_event",
  "webhook_event",
] as const

export type FactoryWaitKind = (typeof FACTORY_WAIT_KINDS)[number]

export type FactoryWaitRequestFields = {
  actorLogin?: string
  assigneeId?: string
  assigneeName?: string
  branch?: string
  channelId?: string
  commentAuthorIds?: string[]
  commentAuthorMode?: "any" | "include" | "exclude"
  commentAuthorNames?: string[]
  endpointId?: string
  event?: string
  events?: string[]
  filters?: Record<string, string>
  issueId?: string
  labelId?: string
  labelName?: string
  messageTs?: string
  note?: string
  prNumber?: number
  prUrl?: string
  stateId?: string
  stateName?: string
  teamId?: string
  teamName?: string
  threadTs?: string
  ttlSeconds?: number
}

const COMMON_FIELDS = new Set<keyof FactoryWaitRequestFields>([
  "note",
  "ttlSeconds",
])

const KIND_FIELDS: Record<
  FactoryWaitKind,
  ReadonlySet<keyof FactoryWaitRequestFields>
> = {
  datadog_event: new Set(["endpointId", "event", "filters"]),
  github_event: new Set(["actorLogin", "branch", "event"]),
  github_pr: new Set(["events", "prNumber", "prUrl"]),
  linear_event: new Set([
    "assigneeId",
    "assigneeName",
    "commentAuthorIds",
    "commentAuthorMode",
    "commentAuthorNames",
    "event",
    "labelId",
    "labelName",
    "stateId",
    "stateName",
    "teamId",
    "teamName",
  ]),
  linear_issue: new Set(["events", "issueId"]),
  pagerduty_event: new Set(["endpointId", "event", "filters"]),
  sentry_event: new Set(["endpointId", "event", "filters"]),
  slack_thread: new Set(["channelId", "events", "messageTs", "threadTs"]),
  webhook_event: new Set(["endpointId", "event", "filters"]),
}

/** Rejects every supplied field that the selected kind does not consume.
 * Silent ignores are dangerous for waits because they broaden the target. */
export function assertWaitKindArguments(
  kind: FactoryWaitKind,
  args: FactoryWaitRequestFields
) {
  const allowed = KIND_FIELDS[kind]
  for (const [field, value] of Object.entries(args) as Array<
    [keyof FactoryWaitRequestFields, unknown]
  >) {
    if (value === undefined || COMMON_FIELDS.has(field) || allowed.has(field)) {
      continue
    }
    throw new Error(`${field} is not valid for ${kind} waits.`)
  }

  if (kind === "github_pr" && args.prNumber !== undefined && args.prUrl) {
    throw new Error("Use prNumber or prUrl, not both.")
  }
}

function optionalString(value: string | undefined) {
  return value?.trim() || undefined
}

function boundedOptionalString(
  value: string | undefined,
  field: string,
  maxLength = 200
) {
  const normalized = optionalString(value)
  if (normalized && normalized.length > maxLength) {
    throw new Error(`${field} must be at most ${maxLength} characters.`)
  }
  return normalized
}

export function normalizeGitHubEventTrigger(args: {
  actorLogin?: string
  branch?: string
  event?: string
}): GitHubFactoryWaitTrigger {
  const event = optionalString(args.event)
  if (
    !event ||
    !(GITHUB_FACTORY_WAIT_EVENTS as readonly string[]).includes(event)
  ) {
    throw new Error(
      `event must be among ${GITHUB_FACTORY_WAIT_EVENTS.join(", ")} for github_event waits.`
    )
  }

  const suppliedActor = optionalString(args.actorLogin)
  const actorLogin = suppliedActor?.replace(/^@/, "").trim().toLowerCase()
  if (suppliedActor && !actorLogin) {
    throw new Error("actorLogin must contain a GitHub login.")
  }
  if (actorLogin && !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(actorLogin)) {
    throw new Error("actorLogin must be a valid GitHub login.")
  }

  const suppliedBranch = optionalString(args.branch)
  const branch = suppliedBranch?.replace(/^refs\/heads\//, "").trim()
  if (suppliedBranch && !branch) {
    throw new Error("branch must contain a branch name.")
  }
  if (branch && event !== "push") {
    throw new Error("branch is only valid for github_event push waits.")
  }
  if (
    branch &&
    (branch.length > 255 ||
      [...branch].some((character) => {
        const code = character.charCodeAt(0)
        return code <= 32 || code === 127
      }) ||
      /[~^:?*\\[]/.test(branch) ||
      branch.includes("..") ||
      branch.includes("@{") ||
      branch.startsWith("/") ||
      branch.endsWith("/") ||
      branch.endsWith(".") ||
      branch.split("/").some((part) => !part || part.endsWith(".lock")))
  ) {
    throw new Error("branch must be a valid Git branch name.")
  }

  return {
    ...(actorLogin ? { actorLogin } : {}),
    ...(branch ? { branch } : {}),
    event: event as GitHubFactoryWaitTrigger["event"],
    kind: "github",
  }
}

export function normalizeLinearEventTrigger(args: {
  assigneeId?: string
  assigneeName?: string
  commentAuthorIds?: string[]
  commentAuthorMode?: "any" | "include" | "exclude"
  commentAuthorNames?: string[]
  event?: string
  labelId?: string
  labelName?: string
  stateId?: string
  stateName?: string
  teamId?: string
  teamName?: string
}): Omit<LinearIntegrationTrigger, "installationId"> {
  const event = optionalString(args.event)
  if (
    !event ||
    !(LINEAR_INTEGRATION_EVENTS as readonly string[]).includes(event)
  ) {
    throw new Error(
      `event must be among ${LINEAR_INTEGRATION_EVENTS.join(", ")} for linear_event waits.`
    )
  }

  const assigneeId = boundedOptionalString(args.assigneeId, "assigneeId")
  const labelId = boundedOptionalString(args.labelId, "labelId")
  const stateId = boundedOptionalString(args.stateId, "stateId")
  const teamId = boundedOptionalString(args.teamId, "teamId")
  const assigneeName = boundedOptionalString(args.assigneeName, "assigneeName")
  const labelName = boundedOptionalString(args.labelName, "labelName")
  const stateName = boundedOptionalString(args.stateName, "stateName")
  const teamName = boundedOptionalString(args.teamName, "teamName")
  const commentAuthorMode = args.commentAuthorMode ?? "any"
  const rawCommentAuthorIds = (args.commentAuthorIds ?? []).map((id) =>
    id.trim()
  )
  if (rawCommentAuthorIds.some((id) => !id)) {
    throw new Error("commentAuthorIds must not contain empty IDs.")
  }
  if (rawCommentAuthorIds.some((id) => id.length > 200)) {
    throw new Error("Linear user IDs must be at most 200 characters.")
  }
  const commentAuthorIds = [...new Set(rawCommentAuthorIds)]
  if (commentAuthorIds.length !== rawCommentAuthorIds.length) {
    throw new Error("commentAuthorIds must not contain duplicates.")
  }
  if (
    args.commentAuthorNames &&
    args.commentAuthorNames.length !== rawCommentAuthorIds.length
  ) {
    throw new Error(
      "commentAuthorNames must be parallel to commentAuthorIds when supplied."
    )
  }
  if (
    args.commentAuthorNames?.some(
      (name) => !name.trim() || name.trim().length > 200
    )
  ) {
    throw new Error(
      "commentAuthorNames must contain non-empty names of at most 200 characters."
    )
  }

  if (event === "issueAssigned" && !assigneeId) {
    throw new Error("assigneeId is required for issueAssigned waits.")
  }
  if (event === "labelAdded" && !labelId) {
    throw new Error("labelId is required for labelAdded waits.")
  }
  if (event === "commentCreated") {
    if (commentAuthorIds.length > LINEAR_COMMENT_AUTHOR_FILTER_MAX) {
      throw new Error(
        `Choose at most ${LINEAR_COMMENT_AUTHOR_FILTER_MAX} comment authors.`
      )
    }
    if (commentAuthorMode !== "any" && commentAuthorIds.length === 0) {
      throw new Error("Choose at least one comment author.")
    }
    if (commentAuthorMode === "any" && commentAuthorIds.length > 0) {
      throw new Error(
        'commentAuthorIds requires commentAuthorMode "include" or "exclude".'
      )
    }
    if (
      (args.commentAuthorNames?.length ?? 0) > 0 &&
      commentAuthorIds.length === 0
    ) {
      throw new Error("commentAuthorNames requires commentAuthorIds.")
    }
  } else if (
    args.commentAuthorMode !== undefined ||
    (args.commentAuthorIds?.length ?? 0) > 0 ||
    (args.commentAuthorNames?.length ?? 0) > 0
  ) {
    throw new Error(
      "commentAuthorMode, commentAuthorIds, and commentAuthorNames are only valid for commentCreated waits."
    )
  }

  if (assigneeId && event !== "issueAssigned" && event !== "issueCreated") {
    throw new Error(
      "assigneeId is only valid for issueAssigned or issueCreated waits."
    )
  }
  if (labelId && event !== "labelAdded" && event !== "issueCreated") {
    throw new Error(
      "labelId is only valid for labelAdded or issueCreated waits."
    )
  }
  if (stateId && event !== "statusChanged" && event !== "issueCreated") {
    throw new Error(
      "stateId is only valid for statusChanged or issueCreated waits."
    )
  }
  if (teamId && event === "commentCreated") {
    throw new Error("teamId is not available on Linear comment webhooks.")
  }
  if (assigneeName && !assigneeId) {
    throw new Error("assigneeName requires assigneeId.")
  }
  if (labelName && !labelId) {
    throw new Error("labelName requires labelId.")
  }
  if (stateName && !stateId) {
    throw new Error("stateName requires stateId.")
  }
  if (teamName && !teamId) {
    throw new Error("teamName requires teamId.")
  }

  const nameByAuthorId = new Map(
    (args.commentAuthorIds ?? []).map((id, index) => [
      id.trim(),
      args.commentAuthorNames?.[index]?.trim(),
    ])
  )

  return {
    ...(assigneeId
      ? { assigneeId, ...(assigneeName ? { assigneeName } : {}) }
      : {}),
    ...(event === "commentCreated"
      ? {
          commentAuthorMode,
          ...(commentAuthorMode === "any"
            ? {}
            : {
                commentAuthorIds,
                commentAuthorNames: commentAuthorIds.map(
                  (id) => nameByAuthorId.get(id) || id
                ),
              }),
        }
      : {}),
    event: event as LinearIntegrationTrigger["event"],
    kind: "linear",
    ...(labelId ? { labelId, ...(labelName ? { labelName } : {}) } : {}),
    ...(stateId ? { stateId, ...(stateName ? { stateName } : {}) } : {}),
    ...(event !== "commentCreated" && teamId
      ? { teamId, ...(teamName ? { teamName } : {}) }
      : {}),
  }
}

export function normalizeExternalEventConfig(args: {
  event?: string
  filters?: Record<string, string>
}) {
  const event = optionalString(args.event)?.toLowerCase()
  if (!event || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(event)) {
    throw new Error(
      "event must be a non-empty provider event name using letters, numbers, dots, colons, underscores, or hyphens."
    )
  }

  const filters: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(args.filters ?? {})) {
    const name = rawName.trim()
    const value = rawValue.trim()
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) {
      throw new Error(`Invalid external event filter name: ${rawName}.`)
    }
    if (!value) throw new Error(`Filter ${name} must not be empty.`)
    if (value.length > 500) {
      throw new Error(`Filter ${name} must be at most 500 characters.`)
    }
    filters[name] = value
  }
  if (Object.keys(filters).length > 20) {
    throw new Error("Choose at most 20 external event filters.")
  }
  return { event, filters }
}

export function validateSlackWaitTarget(
  channelId: string,
  messageTs: string,
  threadTs?: string
) {
  if (!/^[CDG][A-Z0-9]{1,63}$/i.test(channelId)) {
    throw new Error("channelId must be a Slack channel or conversation ID.")
  }
  if (!/^\d{1,20}\.\d{1,20}$/.test(messageTs)) {
    throw new Error("messageTs must be a Slack message timestamp.")
  }
  if (threadTs && !/^\d{1,20}\.\d{1,20}$/.test(threadTs)) {
    throw new Error("threadTs must be a Slack message timestamp.")
  }
}

export function validateLinearIssueId(issueId: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      issueId
    )
  ) {
    throw new Error(
      "issueId must be the Linear issue UUID, not its identifier."
    )
  }
}
