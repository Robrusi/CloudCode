import { AsyncLocalStorage } from "node:async_hooks"

type SlackWebhookContext = {
  appId?: string
  teamId?: string
}

const slackWebhookContext = new AsyncLocalStorage<SlackWebhookContext>()

/** Reads only routing and app identity metadata. The Slack adapter remains
 * responsible for authenticating the request before it invokes any handler
 * that can use this context. */
export async function slackWebhookContextFromRequest(request: Request) {
  try {
    const payload = (await request.clone().json()) as {
      api_app_id?: unknown
      team_id?: unknown
    }
    const appId =
      typeof payload.api_app_id === "string" && payload.api_app_id
        ? payload.api_app_id
        : undefined
    const teamId =
      typeof payload.team_id === "string" && payload.team_id
        ? payload.team_id
        : undefined
    return appId || teamId ? { appId, teamId } : undefined
  } catch {
    return undefined
  }
}

/** Keeps the emitting workspace and receiving app attached to background
 * handler promises created by the Slack adapter, without an extra Slack API
 * request. */
export function withSlackWebhookContext<T>(
  context: SlackWebhookContext | undefined,
  fn: () => T
) {
  return context ? slackWebhookContext.run(context, fn) : fn()
}

export function currentSlackWebhookTeamId() {
  return slackWebhookContext.getStore()?.teamId
}

/** Messages sent through Slack's official MCP use the installing human's
 * user token, so they are neither bot-authored nor adapter "self" messages.
 * Slack does, however, stamp the posting app on the message event. Comparing
 * it with the signed webhook envelope's receiving app ID identifies only
 * CloudCode-originated messages while preserving Slack's visible attribution. */
export function isSlackEventFromCurrentApp(event: unknown) {
  const appId = slackWebhookContext.getStore()?.appId
  if (!appId || !event || typeof event !== "object") return false
  return "app_id" in event && event.app_id === appId
}
