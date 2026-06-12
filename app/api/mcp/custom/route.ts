import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import {
  jsonError,
  jsonNumberField,
  jsonRawStringField,
  readJsonRecord,
  type JsonRecord,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import { encryptSecret } from "@/lib/security/secret-crypto"

export const runtime = "nodejs"

type KeyValue = {
  name: string
  value: string
}

function encryptedPairs(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as KeyValue).name !== "string" ||
      typeof (item as KeyValue).value !== "string"
    ) {
      return []
    }
    const name = (item as KeyValue).name.trim()
    const rawValue = (item as KeyValue).value
    return name && rawValue ? [{ name, value: encryptSecret(rawValue) }] : []
  })
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined
}

function customServerPayload(body: JsonRecord) {
  return {
    args: stringArray(body.args),
    bearerTokenEnvVar: jsonRawStringField(body, "bearerTokenEnvVar"),
    command: jsonRawStringField(body, "command"),
    cwd: jsonRawStringField(body, "cwd"),
    envHttpHeaders: encryptedPairs(body.envHttpHeaders),
    envVars: stringArray(body.envVars),
    httpHeaders: encryptedPairs(body.httpHeaders),
    name: jsonRawStringField(body, "name") ?? "",
    secrets: encryptedPairs(body.secrets),
    transport:
      body.transport === "http" ? ("http" as const) : ("stdio" as const),
    url: jsonRawStringField(body, "url"),
  }
}

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const client = await currentUserConvexHttpClient()
    const serverId = await client.mutation(api.mcpServers.saveCustom, {
      ...customServerPayload(body),
      serverId:
        (jsonRawStringField(body, "serverId") as Id<"mcpServers">) ?? undefined,
      startupTimeoutSec: jsonNumberField(body, "startupTimeoutSec"),
      toolTimeoutSec: jsonNumberField(body, "toolTimeoutSec"),
      tools: Array.isArray(body.tools) ? body.tools : undefined,
    })

    return NextResponse.json({ serverId })
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to save MCP server.",
      400
    )
  }
}

export async function PATCH(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const serverId = jsonRawStringField(body, "serverId")
    if (serverId === undefined) {
      return jsonError("MCP server id is required.", 400)
    }

    const client = await currentUserConvexHttpClient()
    const savedServerId = await client.mutation(api.mcpServers.updateCustom, {
      ...customServerPayload(body),
      removeSecretIds: Array.isArray(body.removeSecretIds)
        ? (body.removeSecretIds.filter(
            (id): id is string => typeof id === "string"
          ) as Id<"mcpServerSecrets">[])
        : undefined,
      serverId: serverId as Id<"mcpServers">,
    })

    return NextResponse.json({ serverId: savedServerId })
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to save MCP server.",
      400
    )
  }
}

export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const client = await currentUserConvexHttpClient()
    const servers = await client.query(api.mcpServers.list, {})

    return NextResponse.json({ servers })
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to load MCP servers.",
      500,
      { servers: [] }
    )
  }
}

export async function DELETE(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const serverId = jsonRawStringField(body, "serverId")
    if (serverId === undefined) {
      return jsonError("MCP server id is required.", 400)
    }

    const client = await currentUserConvexHttpClient()
    await client.mutation(api.mcpServers.remove, {
      serverId: serverId as Id<"mcpServers">,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to remove MCP server.",
      400
    )
  }
}
