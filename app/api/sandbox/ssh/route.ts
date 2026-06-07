import { ConvexHttpClient } from "convex/browser"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getConvexAuthToken } from "@/lib/codex-auth"
import {
  createDaytonaSshAccess,
  revokeDaytonaSshAccess,
} from "@/lib/daytona-sandbox"
import { requireSameOrigin } from "@/lib/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox-authorization"

export const runtime = "nodejs"
export const maxDuration = 300

const MIN_EXPIRES_MINUTES = 5
const MAX_EXPIRES_MINUTES = 24 * 60
const DEFAULT_EXPIRES_MINUTES = 60

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before using Convex storage.")
  }
  return url
}

async function convexClient() {
  const client = new ConvexHttpClient(getConvexUrl())
  client.setAuth(await getConvexAuthToken())
  return client
}

async function parseBody(request: Request) {
  try {
    return (await request.json()) as {
      expiresInMinutes?: unknown
      id?: unknown
      label?: unknown
      sandboxId?: unknown
    }
  } catch {
    return {}
  }
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

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

  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    const client = await convexClient()
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

  const body = await parseBody(request)
  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : ""
  const label = typeof body.label === "string" ? body.label : ""
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    const access = await createDaytonaSshAccess(
      sandboxId,
      normalizeExpiresInMinutes(body.expiresInMinutes)
    )
    const client = await convexClient()
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

  const body = await parseBody(request)
  const id = typeof body.id === "string" ? body.id : ""
  const label = typeof body.label === "string" ? body.label : ""
  if (!id) {
    return jsonError("id required", 400)
  }

  try {
    const client = await convexClient()
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

  const body = await parseBody(request)
  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : ""
  const id = typeof body.id === "string" ? body.id : ""
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }
  if (!id) {
    return jsonError("id required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    const client = await convexClient()
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
