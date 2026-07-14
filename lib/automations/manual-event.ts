import type { AutomationTrigger } from "@/convex/lib/integrationTriggers"

export type ManualEventField = {
  key: string
  label: string
  multiline?: boolean
  placeholder: string
}

const SLACK_FIELDS: ManualEventField[] = [
  {
    key: "message",
    label: "Message",
    multiline: true,
    placeholder: "What should this test message say?",
  },
  { key: "author", label: "Author", placeholder: "Ada Lovelace" },
  { key: "channel", label: "Channel", placeholder: "engineering" },
]

const ISSUE_FIELDS: ManualEventField[] = [
  { key: "issueId", label: "Issue", placeholder: "ENG-123" },
  {
    key: "issueTitle",
    label: "Title",
    placeholder: "Fix the checkout regression",
  },
  {
    key: "issueDescription",
    label: "Description",
    multiline: true,
    placeholder: "Optional issue context",
  },
]

const GITHUB_FIELDS: ManualEventField[] = [
  { key: "number", label: "Number", placeholder: "123" },
  { key: "title", label: "Title", placeholder: "Fix the checkout regression" },
  { key: "actor", label: "Actor", placeholder: "octocat" },
  {
    key: "url",
    label: "URL",
    placeholder: "https://github.com/owner/repo/issues/123",
  },
]

export function manualEventFields(
  trigger: Exclude<AutomationTrigger, { kind: "cron" }>
): ManualEventField[] {
  if (trigger.kind === "slack") {
    return trigger.event === "reaction"
      ? [
          SLACK_FIELDS[0],
          { key: "emoji", label: "Reaction", placeholder: "white_check_mark" },
          ...SLACK_FIELDS.slice(1),
        ]
      : SLACK_FIELDS
  }
  if (trigger.kind === "linear") {
    if (trigger.event === "commentCreated") {
      return [
        ...ISSUE_FIELDS.slice(0, 2),
        {
          key: "commentBody",
          label: "Comment",
          multiline: true,
          placeholder: "Please investigate this regression.",
        },
        {
          key: "commentAuthor",
          label: "Comment author",
          placeholder: "Grace Hopper",
        },
      ]
    }
    if (trigger.event === "issueAssigned") {
      return [
        ...ISSUE_FIELDS,
        {
          key: "issueAssignee",
          label: "Assignee",
          placeholder: "Ada Lovelace",
        },
      ]
    }
    if (trigger.event === "labelAdded") {
      return [
        ...ISSUE_FIELDS,
        {
          key: "addedLabels",
          label: "Added labels",
          placeholder: "bug, urgent",
        },
      ]
    }
    if (trigger.event === "statusChanged") {
      return [
        ...ISSUE_FIELDS,
        { key: "issueStatus", label: "New status", placeholder: "In Progress" },
      ]
    }
    return ISSUE_FIELDS
  }
  if (trigger.event === "issueCommented") {
    return [
      ...GITHUB_FIELDS,
      {
        key: "comment",
        label: "Comment",
        multiline: true,
        placeholder: "Please take a look.",
      },
    ]
  }
  if (trigger.event === "pullRequestReviewSubmitted") {
    return [
      ...GITHUB_FIELDS,
      {
        key: "review",
        label: "Review",
        multiline: true,
        placeholder: "Changes requested on error handling.",
      },
      {
        key: "reviewState",
        label: "Review state",
        placeholder: "changes_requested",
      },
    ]
  }
  if (trigger.event === "push") {
    return [
      { key: "branch", label: "Branch", placeholder: "main" },
      { key: "actor", label: "Actor", placeholder: "octocat" },
      {
        key: "pushHeadCommitMessage",
        label: "Commit message",
        multiline: true,
        placeholder: "Fix checkout regression",
      },
      { key: "pushAfter", label: "Commit SHA", placeholder: "abc123" },
    ]
  }
  return GITHUB_FIELDS
}

function emptyVars(keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, ""]))
}

const SLACK_VAR_KEYS = [
  "author",
  "channel",
  "emoji",
  "message",
  "source",
  "workspace",
] as const
const LINEAR_VAR_KEYS = [
  "addedLabels",
  "commentAuthor",
  "commentAuthorId",
  "commentBody",
  "commentId",
  "commentUrl",
  "event",
  "issueAssignee",
  "issueDescription",
  "issueId",
  "issueStatus",
  "issueTitle",
  "issueUrl",
  "source",
] as const
const GITHUB_VAR_KEYS = [
  "action",
  "actor",
  "branch",
  "comment",
  "commentUrl",
  "event",
  "isPullRequest",
  "issueBody",
  "number",
  "pullRequestBaseBranch",
  "pullRequestBody",
  "pullRequestHeadBranch",
  "pushAfter",
  "pushBefore",
  "pushCompareUrl",
  "pushHeadCommitMessage",
  "repository",
  "repositoryUrl",
  "review",
  "reviewState",
  "reviewUrl",
  "source",
  "title",
  "url",
] as const

export function manualEventContext(
  trigger: Exclude<AutomationTrigger, { kind: "cron" }>,
  repoUrl: string,
  values: Record<string, string>
) {
  const base: Record<string, string> =
    trigger.kind === "slack"
      ? { ...emptyVars(SLACK_VAR_KEYS), source: "slack" }
      : trigger.kind === "linear"
        ? {
            ...emptyVars(LINEAR_VAR_KEYS),
            event: trigger.event,
            source: "linear",
          }
        : {
            ...emptyVars(GITHUB_VAR_KEYS),
            event: trigger.event,
            repositoryUrl: repoUrl,
            source: "github",
          }
  const allowed = new Set(Object.keys(base))
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key) || typeof value !== "string") continue
    base[key] = value.trim()
  }
  if (trigger.kind === "slack") {
    base.channel ||= trigger.channelName ?? trigger.channelId ?? ""
    base.emoji ||= trigger.emoji ?? ""
  }
  if (trigger.kind === "linear") {
    base.issueAssignee ||= trigger.assigneeName ?? trigger.assigneeId ?? ""
    base.addedLabels ||= trigger.labelName ?? trigger.labelId ?? ""
    base.issueStatus ||= trigger.stateName ?? trigger.stateId ?? ""
  }
  if (trigger.kind === "github") {
    base.actor ||= trigger.actorLogin ?? ""
    base.branch ||= trigger.branch ?? ""
  }
  return base
}
