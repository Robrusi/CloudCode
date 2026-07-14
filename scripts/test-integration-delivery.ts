import assert from "node:assert/strict"

import type { Id } from "../convex/_generated/dataModel"
import {
  manualEventContext,
  manualEventFields,
} from "../lib/automations/manual-event"
import { applyEventContext } from "../lib/integrations/events"
import { finalIntegrationResponse } from "../lib/integrations/final-response"

assert.equal(
  finalIntegrationResponse("succeeded", "  The change is ready.  "),
  "The change is ready."
)
assert.equal(finalIntegrationResponse("succeeded", undefined), undefined)
assert.equal(finalIntegrationResponse("succeeded", "   "), undefined)
assert.equal(
  finalIntegrationResponse("failed", "Internal failure detail"),
  undefined
)

const reactionTrigger = {
  channelId: "C123",
  channelName: "shipping",
  emoji: "white_check_mark",
  event: "reaction" as const,
  installationId: "installation-1" as Id<"integrationInstallations">,
  kind: "slack" as const,
}
assert.deepEqual(
  manualEventFields(reactionTrigger).map((field) => field.key),
  ["message", "emoji", "author", "channel"]
)
const manualReaction = manualEventContext(
  reactionTrigger,
  "https://github.com/acme/cloudcode.git",
  { author: "Ada", message: "Ship it" }
)
assert.equal(manualReaction.channel, "shipping")
assert.equal(manualReaction.emoji, "white_check_mark")
assert.equal(manualReaction.message, "Ship it")
assert.equal(
  applyEventContext(
    "Handle {{event.message}} after :{{event.emoji}}: from {{event.author}}.",
    manualReaction
  ).startsWith("Handle Ship it after :white_check_mark: from Ada."),
  true
)

const manualLinear = manualEventContext(
  {
    event: "issueAssigned",
    installationId: "installation-1" as Id<"integrationInstallations">,
    kind: "linear",
    assigneeId: "user-1",
    assigneeName: "Grace Hopper",
  },
  "https://github.com/acme/cloudcode.git",
  { issueId: "ENG-42", issueTitle: "Queue webhook events" }
)
assert.equal(manualLinear.event, "issueAssigned")
assert.equal(manualLinear.issueAssignee, "Grace Hopper")
assert.equal(manualLinear.issueId, "ENG-42")

console.log("Integration final-response delivery checks passed.")
