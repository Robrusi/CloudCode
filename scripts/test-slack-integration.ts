import assert from "node:assert/strict"

import { chatEventPrompt } from "../lib/integrations/events"
import { parseIntegrationMessage } from "../lib/integrations/keywords"
import {
  normalizeSlackDmThreadId,
  slackThreadContextFromMessages,
  slackThreadParts,
  stripSlackBotMention,
} from "../lib/integrations/slack-threads"
import {
  currentSlackWebhookTeamId,
  isSlackEventFromCurrentApp,
  slackWebhookContextFromRequest,
  withSlackWebhookContext,
} from "../lib/integrations/slack-webhook-context"

assert.deepEqual(slackThreadParts("slack:C123:1712345678.123456"), {
  channel: "C123",
  threadTs: "1712345678.123456",
})
assert.deepEqual(slackThreadParts("slack:D123:"), {
  channel: "D123",
  threadTs: undefined,
})
assert.deepEqual(slackThreadParts("slack:D123"), {
  channel: "D123",
  threadTs: undefined,
})

assert.equal(
  normalizeSlackDmThreadId("slack:D123:", "1712345678.123456"),
  "slack:D123:1712345678.123456"
)
assert.equal(
  normalizeSlackDmThreadId("slack:D123", "1712345678.123456"),
  "slack:D123:1712345678.123456"
)
assert.equal(
  normalizeSlackDmThreadId("slack:D123:1712345678.000001", "1712345678.123456"),
  "slack:D123:1712345678.000001"
)
assert.equal(
  normalizeSlackDmThreadId("slack:C123:", "1712345678.123456"),
  "slack:C123:"
)
assert.throws(() => slackThreadParts("linear:D123:1712345678.123456"))
assert.throws(() => slackThreadParts("slack::1712345678.123456"))
assert.throws(() => slackThreadParts("slack:D123:1712345678.123456:extra"))

assert.equal(
  stripSlackBotMention("<@U0BG3L6054P> investigate this", "U0BG3L6054P"),
  "  investigate this"
)
assert.deepEqual(
  parseIntegrationMessage(
    "<@U0BG3L6054P> check with <@UOTHER>",
    "cloudcode",
    "U0BG3L6054P"
  ),
  {
    control: null,
    effortOverride: undefined,
    modelOverride: undefined,
    presetOverride: undefined,
    repoOverride: undefined,
    text: "check with <@UOTHER>",
  }
)

assert.deepEqual(
  parseIntegrationMessage(
    '<@U0BG3L6054P> !repo=owner/repo !preset="Node 20" !model=GPT-5.6-SOL !effort=high investigate this',
    "cloudcode",
    "U0BG3L6054P"
  ),
  {
    control: null,
    effortOverride: "high",
    modelOverride: "GPT-5.6-SOL",
    presetOverride: "Node 20",
    repoOverride: "https://github.com/owner/repo.git",
    text: "investigate this",
  }
)

const slackThreadContext = slackThreadContextFromMessages(
  [
    {
      author: { fullName: "Alice", userName: "alice" },
      id: "1.0",
      text: "Deployments fail after reconnects.",
    },
    {
      author: { fullName: "", userName: "bob" },
      id: "2.0",
      text: "It looks related to session recovery.",
    },
    {
      author: { fullName: "Alice", userName: "alice" },
      id: "3.0",
      text: "<@U0BG3L6054P> please investigate",
    },
  ],
  "3.0",
  "U0BG3L6054P"
)
assert.deepEqual(slackThreadContext, [
  { authorName: "Alice", text: "Deployments fail after reconnects." },
  { authorName: "bob", text: "It looks related to session recovery." },
])
assert.equal(
  chatEventPrompt({
    authorName: "Alice",
    externalThreadId: "slack:C123:1.0",
    kind: "mention",
    messageId: "3.0",
    provider: "slack",
    slackThreadContext,
    text: "please investigate",
  }),
  [
    "please investigate",
    "",
    "---",
    "Requested by Alice from Slack.",
    "",
    "Slack thread before this request:",
    "[Alice] Deployments fail after reconnects.",
    "[bob] It looks related to session recovery.",
  ].join("\n")
)

const webhookRequest = new Request("https://cloudcode.test/api/slack/webhook", {
  body: JSON.stringify({
    api_app_id: "A123",
    team_id: "T123",
    type: "event_callback",
  }),
  headers: { "content-type": "application/json" },
  method: "POST",
})
const webhookContext = await slackWebhookContextFromRequest(webhookRequest)
assert.deepEqual(webhookContext, { appId: "A123", teamId: "T123" })
assert.equal(await webhookRequest.json().then((body) => body.team_id), "T123")

await withSlackWebhookContext(webhookContext, async () => {
  await Promise.resolve()
  assert.equal(currentSlackWebhookTeamId(), "T123")
  assert.equal(isSlackEventFromCurrentApp({ app_id: "A123" }), true)
  assert.equal(isSlackEventFromCurrentApp({ app_id: "A456" }), false)
  assert.equal(isSlackEventFromCurrentApp({}), false)
})
assert.equal(currentSlackWebhookTeamId(), undefined)
assert.equal(isSlackEventFromCurrentApp({ app_id: "A123" }), false)

console.log("Slack integration thread-id checks passed.")
