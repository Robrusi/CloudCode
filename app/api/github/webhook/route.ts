import { tasks } from "@trigger.dev/sdk"
import { ConvexHttpClient } from "convex/browser"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import {
  githubWaitEventName,
  githubWaitSourceKey,
} from "@/convex/lib/factoryWaitTriggers"
import { requireConvexUrl } from "@/lib/convex/env"
import {
  commentMentionsCloudcode,
  isCloudcodeSelfPush,
  isCloudcodeActor,
  isGitHubWebhookConfigured,
  isTrustedMentionAuthor,
  parseIssueCommentWebhookEvent,
  parsePullRequestWebhookEvent,
  verifyGitHubWebhookSignature,
} from "@/lib/github/webhook"
import {
  isGitHubAutomationTriggerEvent,
  parseGitHubAutomationEvent,
  type GitHubAutomationEvent,
} from "@/lib/github/automation-events"
import { jsonError } from "@/lib/http/api-route"
import {
  githubWaitEventVars,
  githubWaitPullRequestNumbers,
} from "@/lib/integrations/events"
import { normalizeReviewPullRequestContext } from "@/lib/reviews/pull-request"
import { getWorkerSecret } from "@/lib/security/worker-secret"
import type { integrationEvent } from "@/trigger/integrations"
import type { reviewDispatch } from "@/trigger/reviews"

export const runtime = "nodejs"

type ReviewDispatchPayload = Parameters<(typeof reviewDispatch)["trigger"]>[0]
type IntegrationEventPayload = Parameters<
  (typeof integrationEvent)["trigger"]
>[0]

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
      pr: normalizeReviewPullRequestContext(parsed.pr),
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

/** Factory waits: does this event land on a PR an agent registered a wait
 * for? Pre-matched here (one indexed Convex query) so unmatched traffic —
 * notably every check suite completion — costs no Trigger task. */
async function waitEventPayloadForEvent(
  event: GitHubAutomationEvent,
  deliveryId: string | null
): Promise<IntegrationEventPayload | null> {
  const eventName = githubWaitEventName(event.event)
  if (!eventName) return null
  // The agent's own PR comments and reviews (posted as the app's bot) must
  // not wake the wait watching for human feedback. State changes (merged,
  // closed, checks) count regardless of the actor.
  if (
    (eventName === "comment" || eventName === "review") &&
    isCloudcodeActor(event.actorLogin)
  ) {
    return null
  }
  const prNumbers = githubWaitPullRequestNumbers(event)
  if (prNumbers.length === 0) return null

  const client = new ConvexHttpClient(requireConvexUrl())
  const matches = await client.query(api.factoryWaits.workerMatchWaitEvents, {
    sourceKeys: prNumbers.map((number) =>
      githubWaitSourceKey(event.repoUrl, number)
    ),
    workerSecret: getWorkerSecret(),
  })
  const waits = matches
    .filter((match) => match.events.includes(eventName))
    .map((match) => ({ threadId: match.threadId, waitId: match.waitId }))
  if (waits.length === 0) return null

  return {
    eventKey:
      deliveryId ??
      `${event.event}:${prNumbers.join(",")}:${event.comment?.id ?? event.actorLogin ?? "unknown"}`,
    eventName,
    eventVars: githubWaitEventVars(event, eventName),
    kind: "wait_event",
    provider: "github",
    waits,
  }
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

  const deliveryId = request.headers.get("x-github-delivery")
  const reviewPayload = dispatchPayloadForEvent(event, payload)
  const githubEvent = parseGitHubAutomationEvent(event, payload)
  const automationPayload: IntegrationEventPayload | null =
    githubEvent &&
    isGitHubAutomationTriggerEvent(githubEvent.event) &&
    !isCloudcodeActor(githubEvent.actorLogin)
      ? {
          deliveryId: deliveryId ?? undefined,
          event: githubEvent,
          kind: "github_automation",
          provider: "github",
        }
      : null

  let waitPayload: IntegrationEventPayload | null = null
  if (githubEvent) {
    try {
      waitPayload = await waitEventPayloadForEvent(githubEvent, deliveryId)
    } catch (error) {
      console.error("/api/github/webhook wait matching failed", error)
      return jsonError("Unable to match GitHub wait events.", 500)
    }
  }

  if (!reviewPayload && !automationPayload && !waitPayload) {
    return NextResponse.json({ ignored: true })
  }

  const dispatches: Promise<unknown>[] = []
  if (reviewPayload) {
    dispatches.push(
      tasks.trigger<typeof reviewDispatch>("review-dispatch", reviewPayload, {
        ...(deliveryId ? { idempotencyKey: `ghd:${deliveryId}` } : {}),
        tags: [`repo:${reviewPayload.repoUrl}`],
      })
    )
  }
  if (automationPayload) {
    dispatches.push(
      tasks.trigger<typeof integrationEvent>(
        "integration-event",
        automationPayload,
        deliveryId ? { idempotencyKey: `gha:${deliveryId}` } : undefined
      )
    )
  }
  if (waitPayload) {
    dispatches.push(
      tasks.trigger<typeof integrationEvent>(
        "integration-event",
        waitPayload,
        deliveryId ? { idempotencyKey: `fwg:${deliveryId}` } : undefined
      )
    )
  }

  try {
    await Promise.all(dispatches)
  } catch (error) {
    console.error("/api/github/webhook dispatch failed", error)
    return jsonError("Unable to dispatch GitHub event.", 500)
  }

  return NextResponse.json({
    automationDispatched: Boolean(automationPayload),
    dispatched: true,
    reviewDispatched: Boolean(reviewPayload),
    waitDispatched: Boolean(waitPayload),
  })
}
