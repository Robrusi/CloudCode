import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import { jsonError } from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import { getInitializedIntegrationsBot } from "@/lib/integrations/bot"
import {
  integrationsStateRedisUrl,
  linearIntegrationEnv,
} from "@/lib/integrations/config"

export const runtime = "nodejs"

/** Teams, labels, workflow states, and assignable people for the automations
 * trigger picker. Resolved through the stored per-organization installation. */
export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  if (!linearIntegrationEnv() || !integrationsStateRedisUrl()) {
    return jsonError("The Linear integration is not configured.", 503)
  }

  try {
    const client = await currentUserConvexHttpClient()
    const installations = await client.query(api.integrations.list, {})
    const linearInstallation = installations.find(
      (installation) => installation.provider === "linear"
    )
    if (!linearInstallation) {
      return jsonError("Connect Linear first.", 400)
    }

    const { linear } = await getInitializedIntegrationsBot()
    if (!linear) {
      return jsonError("The Linear integration is not configured.", 503)
    }

    const options = await linear.withInstallation(
      linearInstallation.externalId,
      async () => {
        const [teamConnection, userConnection] = await Promise.all([
          linear.linearClient.teams({ first: 50 }),
          linear.linearClient.users({ first: 250 }),
        ])
        while (userConnection.pageInfo.hasNextPage) {
          await userConnection.fetchNext()
        }

        const teams = []
        for (const team of teamConnection.nodes) {
          const [labels, states] = await Promise.all([
            team.labels({ first: 100 }),
            team.states({ first: 50 }),
          ])
          teams.push({
            id: team.id,
            key: team.key,
            labels: labels.nodes.map((label) => ({
              id: label.id,
              name: label.name,
            })),
            name: team.name,
            states: states.nodes.map((state) => ({
              id: state.id,
              name: state.name,
            })),
          })
        }

        const users = userConnection.nodes
          .filter((user) => user.active && !user.app && !user.archivedAt)
          .map((user) => ({
            assignable: user.isAssignable,
            email: user.email,
            id: user.id,
            name: user.name,
          }))
          .sort((left, right) => left.name.localeCompare(right.name))

        return { teams, users }
      }
    )

    return NextResponse.json(options)
  } catch (error) {
    console.error("/api/integrations/linear/teams failed", error)
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to load Linear trigger options.",
      500
    )
  }
}
