import { task, tasks } from "@trigger.dev/sdk"

import { api } from "@/convex/_generated/api"
import { getWorkerSecret, workerConvexClient } from "@/lib/codex/run-worker"
import { dispatchIntegrationRun } from "@/lib/integrations/dispatch"
import {
  chatEventPrompt,
  linearAutomationEventVars,
  slackAutomationEventVars,
  type IntegrationChatEventPayload,
  type IntegrationEventPayload,
  type LinearAutomationEventPayload,
  type SlackAutomationEventPayload,
} from "@/lib/integrations/events"
import {
  postRunStarted,
  postToIntegrationThread,
  recordDeliveryFailure,
  type IntegrationThreadRef,
} from "@/lib/integrations/outbound"
import { linearAgentSessionThreadId } from "@/lib/integrations/linear-threads"
import { normalizeSlackDmThreadId } from "@/lib/integrations/slack-threads"
import type { automationRun } from "@/trigger/automations"

const BILLING_EXHAUSTED_MESSAGE =
  "CloudCode's infrastructure usage is exhausted for this account. Upgrade or wait for the included usage to reset."
const MISSING_REPO_MESSAGE =
  "No repository is configured for this integration. Set a default repository in CloudCode → Settings → Connections, or include `!repo=owner/name` in your message."

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Integration event failed."
}

async function deliverBestEffort(
  ref: IntegrationThreadRef,
  deliver: () => Promise<void>
) {
  await deliver().catch(async (error) => {
    console.warn("Unable to reply to the integration thread.", error)
    await recordDeliveryFailure(workerConvexClient(), ref, error)
  })
}

async function replyBestEffort(ref: IntegrationThreadRef, markdown: string) {
  await deliverBestEffort(ref, async () => {
    await postToIntegrationThread(ref, markdown)
  })
}

/** Mentions and follow-up messages: resolve the installation and run owner,
 * then create and dispatch a session run (or queue the message while a run
 * is active) and confirm in the external thread. */
async function handleChatEvent(payload: IntegrationChatEventPayload) {
  const client = workerConvexClient()
  const workerSecret = getWorkerSecret()
  // Normalize again at the durable worker boundary. This also repairs events
  // queued by an older webhook deployment before the DM routing fix landed.
  const externalThreadId =
    payload.provider === "slack"
      ? normalizeSlackDmThreadId(payload.externalThreadId, payload.messageId)
      : payload.linearIssueId && payload.linearAgentSessionId
        ? linearAgentSessionThreadId(
            payload.linearIssueId,
            payload.linearAgentSessionId
          )
        : payload.externalThreadId
  const threadRef: IntegrationThreadRef = {
    externalThreadId,
    linearOrganizationId:
      payload.provider === "linear" ? payload.externalId : undefined,
    provider: payload.provider,
    slackTeamId: payload.provider === "slack" ? payload.externalId : undefined,
  }

  // Keep this call compatible with the original Convex validator. Trigger
  // and Convex deploy independently, so adding optional request fields here
  // can still break every event while the older validator is live. The new
  // Convex implementation derives session identity from externalThreadId.
  const resolved = await client.query(api.integrations.workerResolveEvent, {
    authorEmail: payload.authorEmail,
    externalId: payload.externalId,
    externalThreadId,
    provider: payload.provider,
    workerSecret,
  })
  if (resolved.status !== "ok") {
    if (payload.kind === "mention") {
      await replyBestEffort(
        threadRef,
        "This workspace is not connected to CloudCode yet. Finish the setup in CloudCode → Settings → Connections."
      )
    }
    return { handled: false, reason: resolved.status }
  }
  // Slack events do not always carry the team id; the resolved installation
  // does, and OAuth-mode outbound posts need it to look the token up.
  if (payload.provider === "slack") threadRef.slackTeamId = resolved.externalId

  const bridge = resolved.bridge
  // Every DM message addresses the bot, so a DM without a session bridge
  // starts a session no matter how the webhook generation classified it
  // (stale thread subscriptions can deliver DMs as follow-ups).
  const isSlackDm =
    payload.provider === "slack" && externalThreadId.startsWith("slack:D")
  if (payload.kind === "follow_up") {
    if (bridge?.muted) return { handled: false, reason: "muted" as const }
    if (!bridge && !isSlackDm) {
      return { handled: false, reason: "no_bridge" as const }
    }
    if (bridge?.activeRun && !bridge.requiresCanonicalization) {
      const queued = await client.mutation(
        api.integrations.workerQueuePendingMessage,
        {
          authorName: payload.authorName,
          content: payload.text,
          externalThreadId,
          provider: payload.provider,
          workerSecret,
        }
      )
      return { handled: queued.queued, reason: "queued" as const }
    }
  }

  const userId = bridge?.userId ?? resolved.ownerUserId
  const billing = await client.action(api.billing.checkInfraAccessForWorker, {
    userId,
    workerSecret,
  })
  if (!billing.allowed) {
    await replyBestEffort(threadRef, `❌ ${BILLING_EXHAUSTED_MESSAGE}`)
    return { handled: false, reason: "billing_exhausted" as const }
  }

  // New sessions need a repository; follow-ups continue on the bridged
  // thread's repo, which the create mutation resolves itself.
  const repoUrl = payload.repoOverride ?? resolved.defaultRepoUrl
  if (!repoUrl && !bridge) {
    await replyBestEffort(threadRef, MISSING_REPO_MESSAGE)
    return { handled: false, reason: "missing_repo" as const }
  }

  const created = await client.mutation(
    api.integrations.workerCreateSessionRun,
    {
      installationId: resolved.installationId,
      externalThreadId,
      linearAgentSessionId: payload.linearAgentSessionId,
      linearIssueId: payload.linearIssueId,
      linearOrganizationId:
        payload.provider === "linear" ? payload.externalId : undefined,
      prompt: chatEventPrompt(payload),
      provider: payload.provider,
      repoUrl,
      sandboxPresetName: payload.presetOverride,
      title: payload.subject?.title ?? payload.text,
      userId,
      workerSecret,
    }
  )

  if (!created.ok) {
    if (created.status === "thread_busy") {
      const queued = await client.mutation(
        api.integrations.workerQueuePendingMessage,
        {
          authorName: payload.authorName,
          content: payload.text,
          externalThreadId,
          provider: payload.provider,
          workerSecret,
        }
      )
      if (queued.queued) {
        await replyBestEffort(
          threadRef,
          "A run is already active on this session — I queued your message and will pick it up when the run finishes."
        )
      }
      return { handled: queued.queued, reason: "queued" as const }
    }
    if (
      created.status === "missing_auth" ||
      created.status === "auth_reconnect_required" ||
      created.status === "unknown_preset"
    ) {
      await replyBestEffort(threadRef, `❌ ${created.message}`)
      return { handled: false, reason: created.status }
    }
    if (created.status === "missing_repo") {
      await replyBestEffort(threadRef, MISSING_REPO_MESSAGE)
    }
    return { handled: false, reason: created.status }
  }

  await deliverBestEffort(threadRef, async () => {
    await postRunStarted(threadRef, created.threadId, created.isFollowUp)
  })

  try {
    await dispatchIntegrationRun(client, created)
  } catch (error) {
    await replyBestEffort(threadRef, `❌ ${errorMessage(error)}`)
    throw error
  }

  return { handled: true, runId: created.runId }
}

/** Fires the automations a Slack keyword/reaction event pre-matched in the
 * webhook handler, capped by each automation's fire-rate claim. */
async function handleSlackAutomationEvent(
  payload: SlackAutomationEventPayload
) {
  const client = workerConvexClient()
  const workerSecret = getWorkerSecret()
  const eventVars = slackAutomationEventVars(payload)

  let fired = 0
  for (const automationId of payload.automationIds) {
    const claim = await client.mutation(api.automations.workerClaimEventFire, {
      automationId,
      workerSecret,
    })
    if (!claim.claimed) continue

    await tasks.trigger<typeof automationRun>(
      "automation-run",
      { automationId, eventVars, manual: false },
      {
        idempotencyKey: `${automationId}:${payload.externalId}:${payload.event}:${payload.messageId}:${payload.emoji ?? ""}`,
        tags: [`automation:${automationId}`],
      }
    )
    fired += 1
  }

  return { fired, matched: payload.automationIds.length }
}

/** Matches Linear Issue data changes (labels, status) against event
 * automations and fires the hits. */
async function handleLinearAutomationEvent(
  payload: LinearAutomationEventPayload
) {
  const client = workerConvexClient()
  const workerSecret = getWorkerSecret()

  const resolved = await client.query(api.integrations.workerResolveEvent, {
    externalId: payload.externalId,
    provider: "linear",
    workerSecret,
  })
  if (resolved.status !== "ok") {
    return { fired: 0, reason: resolved.status }
  }

  const sourceKeys = [
    ...new Set(
      payload.events.map(
        (event) => `linear:${resolved.installationId}:${event.event}`
      )
    ),
  ]
  const automations = await client.query(
    api.automations.workerMatchTriggeredAutomations,
    { sourceKeys, workerSecret }
  )

  let fired = 0
  for (const event of payload.events) {
    for (const automation of automations) {
      const trigger = automation.trigger
      if (trigger.kind !== "linear" || trigger.event !== event.event) continue
      if (trigger.teamId && trigger.teamId !== event.issue.teamId) continue
      if (
        trigger.event === "labelAdded" &&
        !event.addedLabels?.some((label) => label.id === trigger.labelId)
      ) {
        continue
      }
      if (
        trigger.event === "statusChanged" &&
        trigger.stateId &&
        trigger.stateId !== event.issue.stateId
      ) {
        continue
      }

      const claim = await client.mutation(
        api.automations.workerClaimEventFire,
        { automationId: automation._id, workerSecret }
      )
      if (!claim.claimed) continue

      await tasks.trigger<typeof automationRun>(
        "automation-run",
        {
          automationId: automation._id,
          eventVars: linearAutomationEventVars(event),
          manual: false,
        },
        {
          idempotencyKey: `${automation._id}:${event.event}:${payload.deliveryId ?? event.issue.id}`,
          tags: [`automation:${automation._id}`],
        }
      )
      fired += 1
    }
  }

  return { fired, matched: automations.length }
}

// One task for every integration event so webhook handlers stay thin: they
// verify, acknowledge, and enqueue here with the platform's delivery id as
// the idempotency key. Redeliveries and Slack retries become no-ops.
export const integrationEvent = task({
  id: "integration-event",
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: IntegrationEventPayload) => {
    switch (payload.kind) {
      case "mention":
      case "follow_up":
        return await handleChatEvent(payload)
      case "slack_automation":
        return await handleSlackAutomationEvent(payload)
      case "linear_automation":
        return await handleLinearAutomationEvent(payload)
    }
  },
})
