import assert from "node:assert/strict"

import { AutumnApiError, createAutumnClient } from "@/convex/lib/autumnClient"

const originalFetch = globalThis.fetch

try {
  const requests: Array<{ body: unknown; headers: Headers; url: string }> = []
  globalThis.fetch = async (input, init) => {
    requests.push({
      body: JSON.parse(String(init?.body)),
      headers: new Headers(init?.headers),
      url: String(input),
    })
    return new Response(
      JSON.stringify({
        balances: {
          infra_usage: {
            next_reset_at: 123,
            remaining: 456,
          },
        },
        subscriptions: [
          {
            current_period_end: 789,
            plan_id: "plus",
            status: "active",
          },
        ],
      }),
      { status: 200 }
    )
  }

  const client = createAutumnClient("am_sk_test")
  const customer = await client.customers.getOrCreate({
    customerId: "user_123",
    email: "person@example.com",
    fingerprint: "subject_123",
    metadata: { convexUserId: "user_123" },
    name: "Person",
  })

  assert.equal(
    requests[0]?.url,
    "https://api.useautumn.com/v1/customers.get_or_create"
  )
  assert.deepEqual(requests[0]?.body, {
    customer_id: "user_123",
    email: "person@example.com",
    fingerprint: "subject_123",
    metadata: { convexUserId: "user_123" },
    name: "Person",
  })
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer am_sk_test")
  assert.equal(customer.balances?.infra_usage?.nextResetAt, 123)
  assert.equal(customer.subscriptions?.[0]?.currentPeriodEnd, 789)
  assert.equal(customer.subscriptions?.[0]?.planId, "plus")

  await client.track(
    {
      customerId: "user_123",
      featureId: "infra_usage",
      properties: { idempotencyKey: "usage:1", resourceId: "run_1" },
      value: 100,
    },
    { headers: { "Idempotency-Key": "usage:1" } }
  )
  assert.deepEqual(requests[1]?.body, {
    customer_id: "user_123",
    feature_id: "infra_usage",
    properties: { idempotencyKey: "usage:1", resourceId: "run_1" },
    value: 100,
  })
  assert.equal(requests[1]?.headers.get("idempotency-key"), "usage:1")

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ code: "reward_not_found", message: "Unknown code" }),
      { status: 404 }
    )

  await assert.rejects(
    () => client.rewards.redeemCode({ code: "NOPE", customerId: "user_123" }),
    (error: unknown) => {
      assert(error instanceof AutumnApiError)
      assert.equal(error.status, 404)
      assert.equal(error.code, "reward_not_found")
      assert.match(error.body ?? "", /reward_not_found/)
      return true
    }
  )

  console.log("billing Autumn client tests passed")
} finally {
  globalThis.fetch = originalFetch
}
