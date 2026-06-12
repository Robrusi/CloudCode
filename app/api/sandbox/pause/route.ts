import { NextResponse } from "next/server"

import { jsonError, readJsonStringField } from "@/lib/http/api-route"
import { observeCurrentUserDaytonaBillingInfo } from "@/lib/billing/server"
import { stopDaytonaSandbox } from "@/lib/daytona/sandbox"
import { requireSameOrigin } from "@/lib/http/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox/authorization"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const sandboxId = await readJsonStringField(request, "sandboxId")
  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    const info = await stopDaytonaSandbox(sandboxId)
    await observeCurrentUserDaytonaBillingInfo(info).catch((error) => {
      console.warn("Unable to observe paused sandbox billing.", error)
    })
    return NextResponse.json(info)
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Failed to pause sandbox.",
      500
    )
  }
}
