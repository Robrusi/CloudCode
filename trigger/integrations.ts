import { task, tasks } from "@trigger.dev/sdk"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { githubAutomationTriggerSourceKey } from "@/convex/lib/integrationTriggers"
import {
  MODELS,
  THINKINGS,
  parseModel,
  parseThinking,
} from "@/lib/chat/options"
import { getWorkerSecret, workerConvexClient } from "@/lib/codex/run-worker"
import { queueFactoryWakeRuns } from "@/lib/factory/wake-dispatch"
import { isGitHubAutomationTriggerEvent } from "@/lib/github/automation-events"
import { dispatchIntegrationRun } from "@/lib/integrations/dispatch"
import { getInitializedIntegrationsBot } from "@/lib/integrations/bot"
import {
  chatEventPrompt,
  githubAutomationEventMatches,
  githubAutomationEventVars,
  linearAutomationEventMatches,
  linearAutomationEventVars,
  slackAutomationEventVars,
  type EventContextVars,
  type FactoryWaitEventPayload,
  type IntegrationChatEventPayload,
  type IntegrationEventPayload,
  type GitHubAutomationEventPayload,
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
import type { automationEventDispatch } from "@/trigger/automations"

const BILLING_EXHAUSTED_MESSAGE =
  "CloudCode's infrastructure usage is exhausted for this account. Upgrade or wait for the included usage to reset."
const MISSING_REPO_MESSAGE =
  "No repository is configured for this integration. Set a default repository in CloudCode → Settings → Connections, or include `!repo=owner/name` in your message."

function parseRequestedRunOptions(payload: IntegrationChatEventPayload) {
  const modelValue = payload.modelOverride?.trim().toLowerCase()
  const model = modelValue ? parseModel(modelValue) : undefined
  if (modelValue && !model) {
    return {
      error: `Unknown model \`${payload.modelOverride}\`. Available: ${MODELS.map((value) => `\`${value}\``).join(", ")}.`,
    }
  }

  const effortValue = payload.effortOverride?.trim().toLowerCase()
  const reasoningEffort = effortValue ? parseThinking(effortValue) : undefined
  if (effortValue && !reasoningEffort) {
    return {
      error: `Unknown reasoning effort \`${payload.effortOverride}\`. Available: ${THINKINGS.map((value) => `\`${value}\``).join(", ")}.`,
    }
  }

  return { model, reasoningEffort }
}

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

async function enqueueAutomationFire(
  client: ReturnType<typeof workerConvexClient>,
  workerSecret: string,
  automationId: Id<"automations">,
  eventKey: string,
  eventVars: Record<string, string>
) {
  const queued = await client.mutation(api.automations.workerEnqueueEventFire, {
    automationId,
    eventKey,
    eventVars,
    workerSecret,
  })
  if (!("queueId" in queued) || !queued.queueId) return queued

  await tasks.trigger<typeof automationEventDispatch>(
    "automation-event-dispatch",
    { automationId },
    {
      idempotencyKey: `${automationId}:queued:${queued.queueId}`,
      tags: [`automation:${automationId}`],
    }
  )
  return queued
}

async function settleAutomationFires(
  fires: Array<Promise<{ queued: boolean }>>
) {
  const settled = await Promise.allSettled(fires)
  const failures = settled.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  )
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `Unable to enqueue ${failures.length} matched automation event(s).`
    )
  }
  return settled.filter(
    (result): result is PromiseFulfilledResult<{ queued: boolean }> =>
      result.status === "fulfilled"
  )
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

  const requestedOptions = parseRequestedRunOptions(payload)
  if (requestedOptions.error) {
    await replyBestEffort(threadRef, `❌ ${requestedOptions.error}`)
    return { handled: false, reason: "invalid_options" as const }
  }

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
          model: requestedOptions.model,
          reasoningEffort: requestedOptions.reasoningEffort,
          externalThreadId,
          provider: payload.provider,
          workerSecret,
        }
      )
      if ("message" in queued) {
        await replyBestEffort(threadRef, `❌ ${queued.message}`)
        return { handled: false, reason: queued.status }
      }
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
      model: requestedOptions.model,
      reasoningEffort: requestedOptions.reasoningEffort,
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
          model: requestedOptions.model,
          reasoningEffort: requestedOptions.reasoningEffort,
          externalThreadId,
          provider: payload.provider,
          workerSecret,
        }
      )
      if ("message" in queued) {
        await replyBestEffort(threadRef, `❌ ${queued.message}`)
        return { handled: false, reason: queued.status }
      }
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
      created.status === "invalid_options" ||
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
  const { slack } = await getInitializedIntegrationsBot()
  if (!slack) return { fired: 0, reason: "not_configured" as const }
  const installation = await slack.getInstallation(payload.externalId)
  if (!installation) return { fired: 0, reason: "not_installed" as const }

  const enriched = await slack.withBotToken(installation.botToken, async () => {
    const user = payload.actorUserId
      ? await slack.getUser(payload.actorUserId).catch(() => null)
      : null
    if (user?.isBot) return null

    if (payload.event !== "reaction" || payload.messageText) {
      return {
        ...payload,
        authorName:
          payload.authorName ??
          user?.fullName ??
          user?.userName ??
          payload.actorUserId,
      }
    }

    const reaction = await slack.webClient.reactions.get({
      channel: payload.channelId,
      full: true,
      timestamp: payload.messageId,
    })
    const messageText = reaction.message?.text
    if (!messageText) {
      throw new Error("Unable to load the reacted Slack message.")
    }
    return {
      ...payload,
      authorName:
        payload.authorName ??
        user?.fullName ??
        user?.userName ??
        payload.actorUserId,
      messageText,
    }
  })
  if (!enriched) return { fired: 0, reason: "bot_actor" as const }

  const eventVars = slackAutomationEventVars(enriched)
  const client = workerConvexClient()
  const workerSecret = getWorkerSecret()
  const eventKey =
    enriched.eventId ??
    `${enriched.externalId}:${enriched.event}:${enriched.messageId}:${enriched.emoji ?? ""}:${enriched.actorUserId ?? "unknown"}`
  const results = await settleAutomationFires(
    enriched.automationIds.map((automationId) =>
      enqueueAutomationFire(
        client,
        workerSecret,
        automationId,
        eventKey,
        eventVars
      )
    )
  )
  const fired = results.filter((result) => result.value.queued).length

  return { fired, matched: enriched.automationIds.length }
}

/** Matches Linear issue changes and human comment creations against event
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

  const events = payload.events.filter(
    (event) =>
      event.event !== "commentCreated" ||
      !resolved.botUserId ||
      event.comment?.authorId !== resolved.botUserId
  )
  if (events.length === 0) {
    return { fired: 0, matched: 0, reason: "self_authored" as const }
  }

  const sourceKeys = [
    ...new Set(
      events.map((event) => `linear:${resolved.installationId}:${event.event}`)
    ),
  ]
  const automations = await client.query(
    api.automations.workerMatchTriggeredAutomations,
    { sourceKeys, workerSecret }
  )

  const fires: Array<Promise<{ queued: boolean }>> = []
  for (const event of events) {
    for (const automation of automations) {
      const trigger = automation.trigger
      if (trigger.kind !== "linear") continue
      if (!linearAutomationEventMatches(trigger, event)) continue

      fires.push(
        enqueueAutomationFire(
          client,
          workerSecret,
          automation._id,
          `${event.event}:${payload.deliveryId ?? event.comment?.id ?? event.issue.id}`,
          linearAutomationEventVars(event)
        )
      )
    }
  }

  const results = await settleAutomationFires(fires)
  const fired = results.filter((result) => result.value.queued).length

  return { fired, matched: automations.length }
}

/** Best-effort Slack author-name lookup for wait events, and the summary
 * line the wake prompt leads with. Enrichment failures fall back to the raw
 * user id — a wake with a plain id beats a lost wake. */
async function enrichSlackWaitEventVars(
  slackInfo: NonNullable<FactoryWaitEventPayload["slack"]>,
  eventVars: EventContextVars,
  eventName: string
): Promise<EventContextVars> {
  let author = slackInfo.actorUserId ?? "someone"
  try {
    const { slack } = await getInitializedIntegrationsBot()
    if (slack && slackInfo.actorUserId) {
      const installation = await slack
        .getInstallation(slackInfo.externalId)
        .catch(() => null)
      const lookupUser = () =>
        slack.getUser(slackInfo.actorUserId!).catch(() => null)
      const user = installation
        ? await slack.withBotToken(installation.botToken, lookupUser)
        : await lookupUser()
      author = user?.fullName ?? user?.userName ?? author
    }
  } catch (error) {
    console.warn("Unable to enrich Slack wait event author.", error)
  }

  const channel = eventVars.channel ? `<#${eventVars.channel}>` : "Slack"
  const summary =
    eventName === "reaction"
      ? `Slack reaction :${eventVars.emoji || "?"}: from ${author} on your message in ${channel}`
      : `Slack reply from ${author} in ${channel}`
  return { ...eventVars, author, summary }
}

/** Records a pre-matched provider event on every wait it matched in one
 * mutation, which creates at most one coalesced wake per affected thread,
 * then dispatches those wakes. Dedupe lives in the mutation (waitId +
 * eventKey), so task retries and webhook redeliveries converge. */
async function handleWaitEvent(payload: FactoryWaitEventPayload) {
  const client = workerConvexClient()
  const workerSecret = getWorkerSecret()

  const eventVars =
    payload.provider === "slack" && payload.slack
      ? await enrichSlackWaitEventVars(
          payload.slack,
          payload.eventVars,
          payload.eventName
        )
      : payload.eventVars

  const result = await client.mutation(
    api.factoryWaits.workerRecordWaitEvents,
    {
      eventKey: payload.eventKey,
      eventName: payload.eventName,
      eventVars,
      externalThreadId: payload.externalThreadId,
      receivedAt: payload.receivedAt,
      waitIds: payload.waits.map((wait) => wait.waitId),
      workerSecret,
    }
  )
  await queueFactoryWakeRuns(result.factoryWakeRuns)

  return { matched: payload.waits.length, queued: result.queued }
}

/** Matches repository-scoped GitHub events and dispatches each automation
 * after the shared feedback-loop rate claim succeeds. */
async function handleGitHubAutomationEvent(
  payload: GitHubAutomationEventPayload
) {
  const client = workerConvexClient()
  const workerSecret = getWorkerSecret()
  const event = payload.event
  // Wait-only events (PR closed/reopened, review comments, check suites)
  // have no automation trigger kind; the webhook route filters them, and
  // this guard keeps redeliveries of stale queue entries safe too.
  if (!isGitHubAutomationTriggerEvent(event.event)) {
    return { fired: 0, matched: 0 }
  }
  const eventId =
    payload.deliveryId ??
    event.comment?.id ??
    event.push?.after ??
    event.review?.url ??
    `${event.event}:${event.pullRequest?.number ?? event.issue?.number ?? "unknown"}:${event.actorLogin ?? "unknown"}`
  const automations = await client.query(
    api.automations.workerMatchTriggeredAutomations,
    {
      githubInstallationId: event.installationId,
      sourceKeys: [
        githubAutomationTriggerSourceKey(event.repoUrl, event.event),
      ],
      workerSecret,
    }
  )

  const fires: Array<Promise<{ queued: boolean }>> = []
  for (const automation of automations) {
    const trigger = automation.trigger
    if (trigger.kind !== "github") continue
    if (!githubAutomationEventMatches(trigger, event)) continue

    fires.push(
      enqueueAutomationFire(
        client,
        workerSecret,
        automation._id,
        eventId,
        githubAutomationEventVars(event)
      )
    )
  }

  const results = await settleAutomationFires(fires)
  const fired = results.filter((result) => result.value.queued).length

  return { fired, matched: automations.length }
}

// One task for every integration event so webhook handlers stay thin: they
// verify, acknowledge, and enqueue here with the platform's delivery id as
// the idempotency key. Redeliveries and Slack retries become no-ops.
export const integrationEvent = task({
  id: "integration-event",
  retry: {
    factor: 2,
    maxAttempts: 5,
    maxTimeoutInMs: 30_000,
    minTimeoutInMs: 1_000,
    randomize: true,
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
      case "github_automation":
        return await handleGitHubAutomationEvent(payload)
      case "wait_event":
        return await handleWaitEvent(payload)
    }
  },
})
