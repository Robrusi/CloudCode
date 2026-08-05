import { createHash } from "node:crypto"

import { ConvexHttpClient } from "convex/browser"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import { EXTERNAL_FACTORY_WAIT_PROVIDERS } from "@/convex/lib/integrationTriggers"
import { requireConvexUrl } from "@/lib/convex/env"
import { jsonError } from "@/lib/http/api-route"
import { normalizeExternalWebhookEvent } from "@/lib/integrations/external-webhooks"
import { enqueueFactoryWaitIngress } from "@/lib/integrations/wait-ingress"
import { getWorkerSecret } from "@/lib/security/worker-secret"

export const runtime = "nodejs"

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024

type RouteParams = {
  endpointId: string
  provider: string
  token: string
}

export async function POST(
  request: Request,
  context: { params: Promise<RouteParams> }
) {
  const { endpointId, provider: rawProvider, token } = await context.params
  if (
    !(EXTERNAL_FACTORY_WAIT_PROVIDERS as readonly string[]).includes(
      rawProvider
    )
  ) {
    return jsonError("Unsupported webhook provider.", 404)
  }
  const provider =
    rawProvider as (typeof EXTERNAL_FACTORY_WAIT_PROVIDERS)[number]
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    return jsonError("Invalid webhook credential.", 401)
  }

  const contentLength = Number(request.headers.get("content-length"))
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_WEBHOOK_BODY_BYTES
  ) {
    return jsonError("Webhook payload is too large.", 413)
  }
  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return jsonError("Webhook payload is too large.", 413)
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return jsonError("Invalid JSON payload.", 400)
  }

  const client = new ConvexHttpClient(requireConvexUrl())
  let claimed
  try {
    claimed = await client.mutation(
      api.factoryWaits.workerClaimWebhookEndpoint,
      {
        endpointId,
        provider,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        workerSecret: getWorkerSecret(),
      }
    )
  } catch (error) {
    // Provider retry policies depend on a 5xx response during infrastructure
    // failures; only an invalid ID/token returned by Convex is a 401.
    console.error("External Factory webhook authentication failed.", error)
    return jsonError("Unable to authenticate webhook.", 500)
  }
  if (!claimed.authenticated) {
    return jsonError("Invalid webhook credential.", 401)
  }

  const bodyHash = createHash("sha256").update(rawBody).digest("hex")
  const normalized = normalizeExternalWebhookEvent(
    provider,
    payload,
    request.headers,
    `body:${bodyHash}`
  )
  if (!normalized) {
    return NextResponse.json({ ignored: true })
  }

  try {
    await enqueueFactoryWaitIngress(client, {
      dedupeKey: `external:${claimed.endpointId}:${normalized.eventName}:${normalized.eventKey}`,
      payload: {
        endpointId: claimed.endpointId,
        eventKey: normalized.eventKey,
        eventName: normalized.eventName,
        eventVars: normalized.eventVars,
        kind: "external_wait_candidate",
        provider,
        receivedAt: claimed.receivedAt,
      },
    })
  } catch (error) {
    console.error("External Factory webhook dispatch failed.", error)
    return jsonError("Unable to dispatch webhook event.", 500)
  }

  return NextResponse.json({ accepted: true, event: normalized.eventName })
}
