import assert from "node:assert/strict"

import { automationTriggerLabel } from "../components/automations/model"
import type { Id } from "../convex/_generated/dataModel"
import {
  parseCommentlessLinearDelegation,
  parseLinearAutomationEvents,
} from "../lib/integrations/linear-webhook"
import { linearAutomationEventMatches } from "../lib/integrations/events"
import {
  linearAgentSessionThreadId,
  linearAgentSessionThreadParts,
} from "../lib/integrations/linear-threads"

assert.equal(
  linearAgentSessionThreadId("issue-1", "session-1"),
  "linear:issue-1:s:session-1"
)
assert.deepEqual(linearAgentSessionThreadParts("linear:issue-1:s:session-1"), {
  agentSessionId: "session-1",
  issueId: "issue-1",
})
assert.equal(
  linearAgentSessionThreadParts("linear:issue-1:c:comment-1:s:session-1"),
  undefined
)

const delegation = parseCommentlessLinearDelegation({
  action: "created",
  agentSession: {
    appUserId: "app-user-1",
    creator: { email: "owner@example.com", name: "Owner" },
    id: "session-1",
    issue: {
      description: "Issue description",
      id: "issue-1",
      identifier: "ENG-1",
      title: "Fix delegation",
      url: "https://linear.app/acme/issue/ENG-1",
    },
  },
  organizationId: "organization-1",
  promptContext: "Complete context from Linear",
  type: "AgentSessionEvent",
  webhookId: "webhook-1",
})

assert.deepEqual(delegation, {
  appUserId: "app-user-1",
  event: {
    authorEmail: "owner@example.com",
    authorName: "Owner",
    externalId: "organization-1",
    externalThreadId: "linear:issue-1:s:session-1",
    kind: "mention",
    linearAgentSessionId: "session-1",
    linearIssueId: "issue-1",
    messageId: "webhook-1",
    provider: "linear",
    subject: {
      description: "Issue description",
      title: "Fix delegation",
      url: "https://linear.app/acme/issue/ENG-1",
    },
    text: "Complete context from Linear",
  },
})

assert.equal(
  parseCommentlessLinearDelegation({
    action: "created",
    agentSession: {
      comment: { id: "comment-1" },
      id: "session-1",
      issueId: "issue-1",
    },
    organizationId: "organization-1",
    type: "AgentSessionEvent",
  }),
  null
)
assert.equal(
  parseCommentlessLinearDelegation({
    action: "prompted",
    agentSession: { id: "session-1", issueId: "issue-1" },
    organizationId: "organization-1",
    type: "AgentSessionEvent",
  }),
  null
)

assert.deepEqual(
  parseLinearAutomationEvents({
    action: "create",
    data: {
      description: "Investigate the regression",
      id: "issue-2",
      identifier: "ENG-2",
      labelIds: ["label-1"],
      labels: [{ id: "label-1", name: "Bug" }],
      state: { id: "state-1", name: "Triage" },
      teamId: "team-1",
      title: "New regression",
      url: "https://linear.app/acme/issue/ENG-2",
    },
    organizationId: "organization-1",
    type: "Issue",
  }),
  {
    events: [
      {
        event: "issueCreated",
        issue: {
          assigneeId: undefined,
          assigneeName: undefined,
          description: "Investigate the regression",
          id: "issue-2",
          identifier: "ENG-2",
          labels: [{ id: "label-1", name: "Bug" }],
          stateId: "state-1",
          stateName: "Triage",
          teamId: "team-1",
          title: "New regression",
          url: "https://linear.app/acme/issue/ENG-2",
        },
      },
    ],
    organizationId: "organization-1",
  }
)

assert.deepEqual(
  parseLinearAutomationEvents({
    action: "create",
    data: { id: "project-1" },
    organizationId: "organization-1",
    type: "Project",
  }),
  { events: [] }
)

const commentEvent = parseLinearAutomationEvents({
  action: "create",
  actor: {
    id: "user-3",
    name: "Grace Hopper",
    type: "user",
  },
  data: {
    body: "Please handle this regression.",
    id: "comment-1",
    issueId: "issue-3",
    userId: "user-3",
  },
  organizationId: "organization-1",
  type: "Comment",
  url: "https://linear.app/acme/issue/ENG-3#comment-comment-1",
}).events[0]
assert.deepEqual(commentEvent, {
  comment: {
    authorId: "user-3",
    authorName: "Grace Hopper",
    body: "Please handle this regression.",
    id: "comment-1",
    url: "https://linear.app/acme/issue/ENG-3#comment-comment-1",
  },
  event: "commentCreated",
  issue: { id: "issue-3" },
})
assert.ok(commentEvent)

const commentTrigger = {
  event: "commentCreated" as const,
  installationId: "installation-1" as Id<"integrationInstallations">,
  kind: "linear" as const,
}
assert.equal(linearAutomationEventMatches(commentTrigger, commentEvent), true)
assert.equal(
  linearAutomationEventMatches(
    {
      ...commentTrigger,
      commentAuthorIds: ["user-3"],
      commentAuthorMode: "include",
    },
    commentEvent
  ),
  true
)
assert.equal(
  linearAutomationEventMatches(
    {
      ...commentTrigger,
      commentAuthorIds: ["user-4"],
      commentAuthorMode: "include",
    },
    commentEvent
  ),
  false
)
assert.equal(
  linearAutomationEventMatches(
    {
      ...commentTrigger,
      commentAuthorIds: ["user-3"],
      commentAuthorMode: "exclude",
    },
    commentEvent
  ),
  false
)
assert.deepEqual(
  parseLinearAutomationEvents({
    action: "create",
    actor: { id: "app-1", name: "CloudCode", type: "oauthClient" },
    data: { body: "Done", id: "comment-2", issueId: "issue-3" },
    organizationId: "organization-1",
    type: "Comment",
  }),
  { events: [] }
)

assert.deepEqual(
  parseLinearAutomationEvents({
    action: "update",
    data: {
      id: "issue-3",
      labelIds: ["label-1", "label-2"],
      labels: [
        { id: "label-1", name: "Bug" },
        { id: "label-2", name: "Urgent" },
      ],
      stateId: "state-2",
      teamId: "team-1",
    },
    organizationId: "organization-1",
    type: "Issue",
    updatedFrom: {
      labelIds: ["label-1"],
      stateId: "state-1",
    },
  }),
  {
    events: [
      {
        addedLabels: [{ id: "label-2", name: "Urgent" }],
        event: "labelAdded",
        issue: {
          assigneeId: undefined,
          assigneeName: undefined,
          description: undefined,
          id: "issue-3",
          identifier: undefined,
          labels: [
            { id: "label-1", name: "Bug" },
            { id: "label-2", name: "Urgent" },
          ],
          stateId: "state-2",
          stateName: undefined,
          teamId: "team-1",
          title: undefined,
          url: undefined,
        },
      },
      {
        event: "statusChanged",
        issue: {
          assigneeId: undefined,
          assigneeName: undefined,
          description: undefined,
          id: "issue-3",
          identifier: undefined,
          labels: [
            { id: "label-1", name: "Bug" },
            { id: "label-2", name: "Urgent" },
          ],
          stateId: "state-2",
          stateName: undefined,
          teamId: "team-1",
          title: undefined,
          url: undefined,
        },
      },
    ],
    organizationId: "organization-1",
  }
)

assert.deepEqual(
  parseLinearAutomationEvents({
    action: "update",
    data: {
      assignee: { id: "user-2", name: "Ada Lovelace" },
      assigneeId: "user-2",
      id: "issue-4",
      identifier: "ENG-4",
      teamId: "team-1",
      title: "Assigned work",
    },
    organizationId: "organization-1",
    type: "Issue",
    updatedFrom: { assigneeId: null },
  }),
  {
    events: [
      {
        event: "issueAssigned",
        issue: {
          assigneeId: "user-2",
          assigneeName: "Ada Lovelace",
          description: undefined,
          id: "issue-4",
          identifier: "ENG-4",
          labels: [],
          stateId: undefined,
          stateName: undefined,
          teamId: "team-1",
          title: "Assigned work",
          url: undefined,
        },
      },
    ],
    organizationId: "organization-1",
  }
)

assert.deepEqual(
  parseLinearAutomationEvents({
    action: "update",
    data: { assigneeId: null, id: "issue-4" },
    organizationId: "organization-1",
    type: "Issue",
    updatedFrom: { assigneeId: "user-2" },
  }),
  { events: [], organizationId: "organization-1" }
)

const assignmentEvent = parseLinearAutomationEvents({
  action: "update",
  data: {
    assignee: { id: "user-2", name: "Ada Lovelace" },
    assigneeId: "user-2",
    id: "issue-4",
    teamId: "team-1",
  },
  type: "Issue",
  updatedFrom: { assigneeId: "user-1" },
}).events[0]
assert.ok(assignmentEvent)

const assignmentTrigger = {
  assigneeId: "user-2",
  assigneeName: "Ada Lovelace",
  event: "issueAssigned" as const,
  installationId: "installation-1" as Id<"integrationInstallations">,
  kind: "linear" as const,
  teamId: "team-1",
}
assert.equal(
  linearAutomationEventMatches(assignmentTrigger, assignmentEvent),
  true
)
assert.equal(
  linearAutomationEventMatches(
    { ...assignmentTrigger, assigneeId: "user-3" },
    assignmentEvent
  ),
  false
)
assert.equal(
  linearAutomationEventMatches(
    { ...assignmentTrigger, teamId: "team-2" },
    assignmentEvent
  ),
  false
)

type AutomationRecord = Parameters<typeof automationTriggerLabel>[0]

assert.equal(
  automationTriggerLabel({
    trigger: {
      commentAuthorMode: "any",
      event: "commentCreated",
      installationId: "installation-1" as Id<"integrationInstallations">,
      kind: "linear",
    },
  } as unknown as AutomationRecord),
  "On comment from anyone"
)
assert.equal(
  automationTriggerLabel({
    trigger: {
      commentAuthorIds: ["user-3", "user-4"],
      commentAuthorMode: "exclude",
      commentAuthorNames: ["Grace Hopper", "Ada Lovelace"],
      event: "commentCreated",
      installationId: "installation-1" as Id<"integrationInstallations">,
      kind: "linear",
    },
  } as unknown as AutomationRecord),
  "On comment except 2 users"
)

assert.equal(
  automationTriggerLabel({
    trigger: {
      assigneeId: "user-2",
      event: "issueAssigned",
      installationId: "installation-1" as Id<"integrationInstallations">,
      kind: "linear",
    },
  } as unknown as AutomationRecord),
  "On issue assigned"
)
assert.equal(
  automationTriggerLabel({
    trigger: {
      assigneeId: "user-2",
      assigneeName: "Ada Lovelace",
      event: "issueAssigned",
      installationId: "installation-1" as Id<"integrationInstallations">,
      kind: "linear",
      teamId: "team-1",
      teamName: "Engineering",
    },
  } as unknown as AutomationRecord),
  "On assigned to Ada Lovelace in Engineering"
)
assert.equal(
  automationTriggerLabel({
    trigger: {
      event: "labelAdded",
      installationId: "installation-1" as Id<"integrationInstallations">,
      kind: "linear",
      labelId: "label-1",
    },
  } as unknown as AutomationRecord),
  "On label added"
)

console.log("Linear integration routing checks passed.")
