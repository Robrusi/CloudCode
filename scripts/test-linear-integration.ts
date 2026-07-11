import assert from "node:assert/strict"

import {
  parseCommentlessLinearDelegation,
  parseLinearIssueAutomationEvents,
} from "../lib/integrations/linear-webhook"
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
  parseLinearIssueAutomationEvents({
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
  parseLinearIssueAutomationEvents({
    action: "create",
    data: { id: "project-1" },
    organizationId: "organization-1",
    type: "Project",
  }),
  { events: [] }
)

assert.deepEqual(
  parseLinearIssueAutomationEvents({
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

console.log("Linear integration routing checks passed.")
