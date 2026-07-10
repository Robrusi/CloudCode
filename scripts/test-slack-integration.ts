import assert from "node:assert/strict"

import {
  normalizeSlackDmThreadId,
  slackThreadParts,
} from "../lib/integrations/slack-threads"

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

console.log("Slack integration thread-id checks passed.")
