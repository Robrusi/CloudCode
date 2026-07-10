import { AsyncLocalStorage } from "node:async_hooks"

type SlackWebhookContext = {
  teamId: string
}

const slackWebhookContext = new AsyncLocalStorage<SlackWebhookContext>()

/** Reads only routing metadata. The Slack adapter remains responsible for
 * authenticating the request before it invokes any handler that can use it. */
export async function slackTeamIdFromWebhookRequest(request: Request) {
  try {
    const payload = (await request.clone().json()) as {
      team_id?: unknown
    }
    return typeof payload.team_id === "string" && payload.team_id
      ? payload.team_id
      : undefined
  } catch {
    return undefined
  }
}

/** Keeps the emitting workspace attached to background handler promises
 * created by the Slack adapter, without an extra Slack API request. */
export function withSlackWebhookTeam<T>(
  teamId: string | undefined,
  fn: () => T
) {
  return teamId ? slackWebhookContext.run({ teamId }, fn) : fn()
}

export function currentSlackWebhookTeamId() {
  return slackWebhookContext.getStore()?.teamId
}
