import assert from "node:assert/strict"

import {
  normalizeSlackDmThreadId,
  slackThreadParts,
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
