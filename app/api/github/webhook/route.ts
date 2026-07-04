import { tasks } from "@trigger.dev/sdk"
import { NextResponse } from "next/server"

import {
  isGitHubWebhookConfigured,
  parsePullRequestWebhookEvent,
  verifyGitHubWebhookSignature,
} from "@/lib/github/webhook"
import { jsonError } from "@/lib/http/api-route"
import type { reviewDispatch } from "@/trigger/reviews"

export const runtime = "nodejs"

// GitHub is the caller, so there is no session and no same-origin check: the
// HMAC signature over the raw body is the authentication. GitHub times out
// after 10s, so the route only verifies, filters, and hands off to Trigger.
export async function POST(request: Request) {
  if (!isGitHubWebhookConfigured()) {
    return jsonError("GitHub webhook is not configured.", 503)
  }

  const rawBody = await request.text()
  if (
    !verifyGitHubWebhookSignature(
      rawBody,
      request.headers.get("x-hub-signature-256")
    )
  ) {
    return jsonError("Invalid webhook signature.", 401)
  }

  const event = request.headers.get("x-github-event")
  if (event === "ping") return NextResponse.json({ ok: true })
  if (event !== "pull_request") {
    return NextResponse.json({ ignored: true })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return jsonError("Invalid JSON payload.", 400)
  }

  const parsed = parsePullRequestWebhookEvent(payload)
  if (!parsed) return NextResponse.json({ ignored: true })

  // "opened" skips drafts; drafts get their review from "ready_for_review",
  // which each config opts into (enforced in the dispatch task, which has
  // the config data).
  const shouldDispatch =
    (parsed.action === "opened" && !parsed.pr.draft) ||
    parsed.action === "ready_for_review"
  if (!shouldDispatch) return NextResponse.json({ ignored: true })

  const deliveryId = request.headers.get("x-github-delivery")
  try {
    await tasks.trigger<typeof reviewDispatch>(
      "review-dispatch",
      {
        action: parsed.action,
        pr: parsed.pr,
        repoUrl: parsed.repoUrl,
      },
      {
        ...(deliveryId ? { idempotencyKey: `ghd:${deliveryId}` } : {}),
        tags: [`repo:${parsed.repoFullName}`],
      }
    )
  } catch (error) {
    console.error("/api/github/webhook dispatch failed", error)
    return jsonError("Unable to dispatch review.", 500)
  }

  return NextResponse.json({ dispatched: true })
}
