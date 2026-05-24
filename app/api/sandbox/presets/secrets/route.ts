import { ConvexHttpClient } from "convex/browser"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getConvexAuthToken } from "@/lib/codex-auth"
import { requireSameOrigin } from "@/lib/request-security"
import { encryptSecret } from "@/lib/secret-crypto"

export const runtime = "nodejs"

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

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = (await request.json()) as {
      name?: unknown
      presetId?: unknown
      value?: unknown
    }

    if (
      typeof body.presetId !== "string" ||
      typeof body.name !== "string" ||
      typeof body.value !== "string"
    ) {
      return NextResponse.json(
        { error: "presetId, name, and value are required." },
        { status: 400 }
      )
    }

    const client = await convexClient()
    const id = await client.mutation(api.sandboxPresets.upsertSecret, {
      name: body.name,
      presetId: body.presetId as Id<"sandboxPresets">,
      value: encryptSecret(body.value),
    })

    return NextResponse.json({ id })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save secret.",
      },
      { status: 500 }
    )
  }
}
