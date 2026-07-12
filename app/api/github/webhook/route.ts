import { tasks } from "@trigger.dev/sdk"
import { NextResponse } from "next/server"

import {
  commentMentionsCloudcode,
  isCloudcodeSelfPush,
  isGitHubWebhookConfigured,
  isTrustedMentionAuthor,
  parseIssueCommentWebhookEvent,
  parsePullRequestWebhookEvent,
  verifyGitHubWebhookSignature,
} from "@/lib/github/webhook"
import { jsonError } from "@/lib/http/api-route"
import type { reviewDispatch } from "@/trigger/reviews"

export const runtime = "nodejs"

type ReviewDispatchPayload = Parameters<(typeof reviewDispatch)["trigger"]>[0]

function dispatchPayloadForEvent(
  event: string | null,
  payload: unknown
): ReviewDispatchPayload | null {
  if (event === "pull_request") {
    const parsed = parsePullRequestWebhookEvent(payload)
    if (!parsed) return null

    // An opened PR always gets its initial review, including a draft. Otherwise
    // an "Opened PRs" config would ignore the draft on open and then ignore its
    // ready_for_review event too. Synchronize still waits until a draft is ready.
    // Which configs react to ready_for_review and synchronize is enforced in
    // the dispatch task, which has config data.
    const shouldDispatch =
      parsed.action === "opened" ||
      (parsed.action === "synchronize" && !parsed.pr.draft) ||
      parsed.action === "ready_for_review"
    if (!shouldDispatch) return null

    // Our own autofix push fires a synchronize; re-reviewing it would loop
    // (fix → push → synchronize → fix …), so drop the app's self-pushes.
    if (parsed.action === "synchronize" && isCloudcodeSelfPush(parsed)) {
      return null
    }

    return {
      action: parsed.action,
      pr: parsed.pr,
      repoUrl: parsed.repoUrl,
    }
  }

  if (event === "issue_comment") {
    const parsed = parseIssueCommentWebhookEvent(payload)
    if (
      !parsed ||
      parsed.action !== "created" ||
      !commentMentionsCloudcode(parsed) ||
      !isTrustedMentionAuthor(parsed)
    ) {
      return null
    }

    return {
      action: "mention",
      comment: {
        authorLogin: parsed.authorLogin,
        body: parsed.body,
        id: parsed.commentId,
      },
      prNumber: parsed.prNumber,
      repoUrl: parsed.repoUrl,
    }
  }

  return null
}

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

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return jsonError("Invalid JSON payload.", 400)
  }

  const dispatchPayload = dispatchPayloadForEvent(event, payload)
  if (!dispatchPayload) return NextResponse.json({ ignored: true })

  const deliveryId = request.headers.get("x-github-delivery")
  try {
    await tasks.trigger<typeof reviewDispatch>(
      "review-dispatch",
      dispatchPayload,
      {
        ...(deliveryId ? { idempotencyKey: `ghd:${deliveryId}` } : {}),
        tags: [`repo:${dispatchPayload.repoUrl}`],
      }
    )
  } catch (error) {
    console.error("/api/github/webhook dispatch failed", error)
    return jsonError("Unable to dispatch review.", 500)
  }

  return NextResponse.json({ dispatched: true })
}
