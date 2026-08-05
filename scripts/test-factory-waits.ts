import assert from "node:assert/strict"

import type { ConvexHttpClient } from "convex/browser"

import type { Id } from "../convex/_generated/dataModel"
import {
  githubEventTriggerSourceKey,
  linearEventTriggerSourceKey,
} from "../convex/lib/integrationTriggers"
import { cloudcodeFactorySkill } from "../lib/daytona/codex-skills"
import {
  cloudcodeFactoryAgentContext,
  cloudcodeFactoryAgentInstructions,
} from "../lib/daytona/factory"
import {
  assertWaitKindArguments,
  normalizeExternalEventConfig,
  normalizeGitHubEventTrigger,
  normalizeLinearEventTrigger,
} from "../lib/factory/wait-config"
import {
  parseGitHubAutomationEvent,
  type GitHubAutomationEvent,
} from "../lib/github/automation-events"
import {
  githubEventWaitVars,
  githubIntegrationEventMatches,
  linearEventWaitVars,
  linearIntegrationEventMatches,
  type LinearAutomationEvent,
} from "../lib/integrations/events"
import {
  externalWebhookEventMatches,
  normalizeExternalWebhookEvent,
} from "../lib/integrations/external-webhooks"
import { matchGitHubWaitEvent } from "../lib/integrations/wait-dispatch"

const repoUrl = "https://github.com/acme/cloudcode"
const installationId = "installation-1" as Id<"integrationInstallations">
const openedPullRequest = parseGitHubAutomationEvent("pull_request", {
  action: "opened",
  installation: { id: 1 },
  pull_request: {
    base: { ref: "main" },
    head: { ref: "feature/wakes" },
    html_url: `${repoUrl}/pull/42`,
    number: 42,
    title: "Extend Factory waits",
  },
  repository: { full_name: "acme/cloudcode" },
  sender: { login: "OctoCat" },
})
assert.ok(openedPullRequest)

assert.equal(
  githubEventTriggerSourceKey(repoUrl, "pullRequestOpened"),
  "github:https://github.com/acme/cloudcode.git:pullRequestOpened"
)
assert.equal(
  githubIntegrationEventMatches(
    { actorLogin: "octocat", event: "pullRequestOpened", kind: "github" },
    openedPullRequest
  ),
  true
)
assert.equal(
  githubIntegrationEventMatches(
    { actorLogin: "someone-else", event: "pullRequestOpened", kind: "github" },
    openedPullRequest
  ),
  false
)

assert.throws(
  () =>
    assertWaitKindArguments("github_event", {
      event: "pullRequestOpened",
      prNumber: 42,
    }),
  /prNumber is not valid for github_event/
)
assert.throws(
  () => normalizeGitHubEventTrigger({ actorLogin: "@", event: "push" }),
  /must contain a GitHub login/
)
assert.throws(
  () =>
    normalizeGitHubEventTrigger({
      actorLogin: "not a login",
      event: "pullRequestOpened",
    }),
  /valid GitHub login/
)
assert.throws(
  () => normalizeGitHubEventTrigger({ branch: "refs/heads/", event: "push" }),
  /must contain a branch name/
)
assert.throws(
  () => normalizeGitHubEventTrigger({ branch: "bad..branch", event: "push" }),
  /valid Git branch name/
)

const createdAssigned: LinearAutomationEvent = {
  event: "issueCreated",
  issue: {
    assigneeId: "user-2",
    id: "issue-2",
    labels: [{ id: "label-1" }],
    stateId: "state-1",
    teamId: "team-1",
  },
}
const createdAssignedTrigger = {
  ...normalizeLinearEventTrigger({
    assigneeId: "user-2",
    event: "issueCreated",
    labelId: "label-1",
    stateId: "state-1",
    teamId: "team-1",
  }),
  installationId,
}
assert.equal(
  linearIntegrationEventMatches(createdAssignedTrigger, createdAssigned),
  true
)
assert.equal(
  linearIntegrationEventMatches(
    { ...createdAssignedTrigger, assigneeId: "user-9" },
    createdAssigned
  ),
  false
)
assert.throws(
  () =>
    normalizeLinearEventTrigger({
      commentAuthorIds: ["user-1"],
      event: "commentCreated",
    }),
  /requires commentAuthorMode/
)
assert.throws(
  () =>
    normalizeLinearEventTrigger({
      commentAuthorIds: ["user-1", "user-1"],
      commentAuthorMode: "include",
      event: "commentCreated",
    }),
  /must not contain duplicates/
)

assert.deepEqual(normalizeExternalEventConfig({ event: " Issue.Created " }), {
  event: "issue.created",
  filters: {},
})

const sentryEvent = normalizeExternalWebhookEvent(
  "sentry",
  {
    action: "created",
    data: {
      event: { environment: "production", level: "error" },
      issue: {
        id: "123",
        project: { slug: "api" },
        title: "Checkout failed",
        web_url: "https://sentry.example/issues/123",
      },
    },
  },
  new Headers({
    "sentry-hook-request-id": "delivery-1",
    "sentry-hook-resource": "issue",
  }),
  "fallback"
)
assert.ok(sentryEvent)
assert.equal(sentryEvent.eventName, "issue.created")
assert.equal(sentryEvent.eventVars.project, "api")
assert.equal(
  externalWebhookEventMatches(
    {
      endpointId: "endpoint-1" as Id<"factoryWebhookEndpoints">,
      event: "issue.created",
      filters: { environment: "PRODUCTION", Project: "API" },
      kind: "external",
      provider: "sentry",
    },
    sentryEvent.eventName,
    sentryEvent.eventVars
  ),
  true
)

const datadogEvent = normalizeExternalWebhookEvent(
  "datadog",
  {
    ALERT_ID: "monitor-1",
    ALERT_TITLE: "Checkout errors",
    ALERT_TRANSITION: "Triggered",
    TAGS: "service:checkout,env:production",
  },
  new Headers(),
  "datadog-fallback"
)
assert.ok(datadogEvent)
assert.equal(datadogEvent.eventName, "monitor.triggered")
assert.equal(datadogEvent.eventVars.service, "checkout")

const pagerDutyEvent = normalizeExternalWebhookEvent(
  "pagerduty",
  {
    event: {
      data: {
        id: "incident-1",
        service: { summary: "Payments" },
        title: "Payment API down",
        urgency: "high",
      },
      event_type: "incident.triggered",
      id: "delivery-2",
    },
  },
  new Headers(),
  "pagerduty-fallback"
)
assert.ok(pagerDutyEvent)
assert.equal(pagerDutyEvent.eventName, "incident.triggered")
assert.equal(pagerDutyEvent.eventVars.service, "Payments")

const genericEvent = normalizeExternalWebhookEvent(
  "webhook",
  {
    environment: "production",
    event: "deploy.failed",
    service: "worker",
    title: "Production deploy failed",
  },
  new Headers({ "x-webhook-id": "delivery-3" }),
  "generic-fallback"
)
assert.ok(genericEvent)
assert.equal(genericEvent.eventName, "deploy.failed")
assert.equal(genericEvent.eventVars.service, "worker")
assert.match(
  githubEventWaitVars(openedPullRequest).summary,
  /GitHub PR #42 opened by OctoCat/
)

let matchedSourceKeys: string[] = []
process.env.TRIGGER_WORKER_SECRET ??= "factory-wait-test-secret"
const fakeClient = {
  query: async (_reference: unknown, args: { sourceKeys: string[] }) => {
    matchedSourceKeys = args.sourceKeys
    return [
      {
        eventTrigger: {
          actorLogin: "octocat",
          event: "pullRequestOpened",
          kind: "github" as const,
        },
        events: ["pullRequestOpened"],
        provider: "github" as const,
        threadId: "thread-1" as Id<"threads">,
        userId: "user-1" as Id<"users">,
        waitId: "wait-1" as Id<"factoryWaits">,
      },
    ]
  },
} as unknown as ConvexHttpClient
const matchedGitHub = await matchGitHubWaitEvent(
  fakeClient,
  openedPullRequest,
  "delivery-1",
  123
)
assert.ok(matchedGitHub)
assert.equal(matchedGitHub.waits.length, 1)
assert.ok(
  matchedSourceKeys.includes(
    "github:1:https://github.com/acme/cloudcode.git:pullRequestOpened"
  )
)

const push: GitHubAutomationEvent = {
  action: "push",
  actorLogin: "octocat",
  branch: "main",
  event: "push",
  installationId: "installation-1",
  push: { after: "def", before: "abc" },
  repoFullName: "acme/cloudcode",
  repoUrl,
}
assert.equal(
  githubIntegrationEventMatches(
    { branch: "main", event: "push", kind: "github" },
    push
  ),
  true
)
assert.equal(
  githubIntegrationEventMatches(
    { branch: "release", event: "push", kind: "github" },
    push
  ),
  false
)

const assignment: LinearAutomationEvent = {
  event: "issueAssigned",
  issue: {
    assigneeId: "user-2",
    assigneeName: "Ada Lovelace",
    id: "issue-1",
    identifier: "ENG-1",
    teamId: "team-1",
    title: "Handle the queue",
    url: "https://linear.app/acme/issue/ENG-1",
  },
}

assert.equal(
  linearEventTriggerSourceKey(installationId, "issueAssigned"),
  "linear:installation-1:issueAssigned"
)
assert.equal(
  linearIntegrationEventMatches(
    {
      assigneeId: "user-2",
      event: "issueAssigned",
      installationId,
      kind: "linear",
      teamId: "team-1",
    },
    assignment
  ),
  true
)
assert.equal(
  linearIntegrationEventMatches(
    {
      assigneeId: "user-3",
      event: "issueAssigned",
      installationId,
      kind: "linear",
      teamId: "team-1",
    },
    assignment
  ),
  false
)
assert.match(
  linearEventWaitVars(assignment).summary,
  /Linear issue ENG-1 assigned to Ada Lovelace/
)

const comment: LinearAutomationEvent = {
  comment: {
    authorId: "user-3",
    authorName: "Grace Hopper",
    body: "Please take another look.",
    id: "comment-1",
  },
  event: "commentCreated",
  issue: { id: "issue-1", identifier: "ENG-1" },
}
assert.equal(
  linearIntegrationEventMatches(
    {
      commentAuthorIds: ["user-3"],
      commentAuthorMode: "include",
      event: "commentCreated",
      installationId,
      kind: "linear",
    },
    comment
  ),
  true
)
assert.equal(
  linearIntegrationEventMatches(
    {
      commentAuthorIds: ["user-3"],
      commentAuthorMode: "exclude",
      event: "commentCreated",
      installationId,
      kind: "linear",
    },
    comment
  ),
  false
)

const factorySkill = cloudcodeFactorySkill().skillMd
const removedQuestionTool = ["ask", "human"].join("_")
assert.equal(factorySkill.includes(removedQuestionTool), false)
assert.match(factorySkill, /kind: "github_event"/)
assert.match(factorySkill, /kind: "linear_event"/)
assert.match(factorySkill, /kind: "sentry_event"/)
assert.match(factorySkill, /webhook_endpoint_rotate/)
assert.equal(
  cloudcodeFactoryAgentInstructions().includes(removedQuestionTool),
  false
)
assert.equal(
  cloudcodeFactoryAgentContext().includes(removedQuestionTool),
  false
)

console.log("Factory event wait checks passed.")
