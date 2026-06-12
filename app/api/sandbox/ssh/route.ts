import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { currentUserConvexHttpClient } from "@/lib/convex/http"
import {
  createDaytonaSshAccess,
  revokeDaytonaSshAccess,
} from "@/lib/daytona/sandbox"
import {
  jsonError,
  jsonStringField,
  readJsonRecord,
  searchStringParam,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox/authorization"

export const runtime = "nodejs"
export const maxDuration = 300

const MIN_EXPIRES_MINUTES = 5
const MAX_EXPIRES_MINUTES = 24 * 60
const DEFAULT_EXPIRES_MINUTES = 60

function normalizeExpiresInMinutes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_EXPIRES_MINUTES
  }
  const rounded = Math.round(value)
  return Math.min(MAX_EXPIRES_MINUTES, Math.max(MIN_EXPIRES_MINUTES, rounded))
}

export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const sandboxId = searchStringParam(request, "sandboxId")
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    const client = await currentUserConvexHttpClient()
    const connections = await client.query(api.sshAccess.list, { sandboxId })
    return NextResponse.json({ connections })
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Failed to list SSH access.",
      500
    )
  }
}

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const body = await readJsonRecord(request)
  const sandboxId = jsonStringField(body, "sandboxId")
  const label = jsonStringField(body, "label") ?? ""
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    const access = await createDaytonaSshAccess(
      sandboxId,
      normalizeExpiresInMinutes(body.expiresInMinutes)
    )
    const client = await currentUserConvexHttpClient()
    const id = await client.mutation(api.sshAccess.create, {
      accessId: access.accessId,
      expiresAt: Date.parse(access.expiresAt),
      label,
      sandboxId,
      sshCommand: access.sshCommand,
      token: access.token,
    })
    return NextResponse.json({ id })
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Failed to create SSH access.",
      500
    )
  }
}

export async function PATCH(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const body = await readJsonRecord(request)
  const id = jsonStringField(body, "id")
  const label = jsonStringField(body, "label") ?? ""
  if (!id) {
    return jsonError("id required", 400)
  }

  try {
    const client = await currentUserConvexHttpClient()
    await client.mutation(api.sshAccess.rename, {
      id: id as Id<"sshAccessTokens">,
      label,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Failed to rename SSH key.",
      500
    )
  }
}

export async function DELETE(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const body = await readJsonRecord(request)
  const sandboxId = jsonStringField(body, "sandboxId")
  const id = jsonStringField(body, "id")
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }
  if (!id) {
    return jsonError("id required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    const client = await currentUserConvexHttpClient()
    const record = await client.query(api.sshAccess.get, {
      id: id as Id<"sshAccessTokens">,
    })
    if (!record || record.sandboxId !== sandboxId) {
      return jsonError("SSH key not found.", 404)
    }

    await revokeDaytonaSshAccess(sandboxId, record.token)
    await client.mutation(api.sshAccess.remove, {
      id: id as Id<"sshAccessTokens">,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Failed to revoke SSH access.",
      500
    )
  }
}
