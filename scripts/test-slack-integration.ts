import assert from "node:assert/strict"

import {
  normalizeSlackDmThreadId,
  slackThreadParts,
} from "../lib/integrations/slack-threads"
import {
  currentSlackWebhookTeamId,
  slackTeamIdFromWebhookRequest,
  withSlackWebhookTeam,
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
  body: JSON.stringify({ team_id: "T123", type: "event_callback" }),
  headers: { "content-type": "application/json" },
  method: "POST",
})
assert.equal(await slackTeamIdFromWebhookRequest(webhookRequest), "T123")
assert.equal(await webhookRequest.json().then((body) => body.team_id), "T123")

await withSlackWebhookTeam("T123", async () => {
  await Promise.resolve()
  assert.equal(currentSlackWebhookTeamId(), "T123")
})
assert.equal(currentSlackWebhookTeamId(), undefined)

console.log("Slack integration thread-id checks passed.")
