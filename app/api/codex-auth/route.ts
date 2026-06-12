import { NextResponse } from "next/server"

import {
  disconnectCodexAuthProfile,
  getCodexAuthStatus,
  renameCodexAuthProfile,
  saveCodexAuthJson,
  setActiveCodexAuthProfile,
} from "@/lib/codex/auth"
import {
  jsonError,
  jsonRawStringField,
  readJsonRecord,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const status = await getCodexAuthStatus(
      searchParams.get("profile") ?? undefined
    )

    return NextResponse.json(status)
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to read auth status.",
      400
    )
  }
}

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const authJson = jsonRawStringField(body, "authJson")

    if (authJson === undefined) {
      return jsonError("authJson must be a string.", 400)
    }

    const status = await saveCodexAuthJson(
      jsonRawStringField(body, "profile"),
      authJson
    )

    return NextResponse.json(status)
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to store auth.json.",
      400
    )
  }
}

export async function PATCH(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const profile = jsonRawStringField(body, "profile")

    if (profile === undefined) {
      return jsonError("profile must be a string.", 400)
    }

    if ("displayName" in body) {
      const displayName = jsonRawStringField(body, "displayName")
      if (displayName === undefined) {
        return jsonError("displayName must be a string.", 400)
      }

      return NextResponse.json(
        await renameCodexAuthProfile(profile, displayName)
      )
    }

    return NextResponse.json(await setActiveCodexAuthProfile(profile))
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to switch ChatGPT account.",
      400
    )
  }
}

export async function DELETE(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = await readJsonRecord(request)
    const profile = jsonRawStringField(body, "profile")

    if (profile === undefined) {
      return jsonError("profile must be a string.", 400)
    }

    return NextResponse.json(await disconnectCodexAuthProfile(profile))
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to disconnect ChatGPT account.",
      400
    )
  }
}
