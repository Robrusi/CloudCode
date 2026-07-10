import assert from "node:assert/strict"

import { parseCommentlessLinearDelegation } from "../lib/integrations/linear-webhook"
import { linearAgentSessionThreadId } from "../lib/integrations/linear-threads"

assert.equal(
  linearAgentSessionThreadId("issue-1", "session-1"),
  "linear:issue-1:s:session-1"
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

console.log("Linear integration routing checks passed.")
