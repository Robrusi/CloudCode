import { after } from "next/server"

import { jsonError } from "@/lib/http/api-route"
import { getIntegrationsBot } from "@/lib/integrations/bot"
import {
  integrationsStateRedisUrl,
  slackIntegrationEnv,
} from "@/lib/integrations/config"

export const runtime = "nodejs"

// Slack is the caller: the Chat SDK verifies the request signature over the
// raw body (SLACK_SIGNING_SECRET), answers url_verification challenges, and
// dedupes retries. Slack expects a 200 within 3 seconds, so handlers run in
// the background via waitUntil and only acknowledge + enqueue Trigger tasks.
export async function POST(request: Request) {
  if (!slackIntegrationEnv() || !integrationsStateRedisUrl()) {
    return jsonError("The Slack integration is not configured.", 503)
  }

  const { bot } = getIntegrationsBot()
  return await bot.webhooks.slack(request, {
    waitUntil: (task) => after(() => task),
  })
}
