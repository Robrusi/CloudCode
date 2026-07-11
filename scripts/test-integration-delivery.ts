import assert from "node:assert/strict"

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

console.log("Integration final-response delivery checks passed.")
