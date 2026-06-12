import { NextResponse } from "next/server"

import { jsonError, readJsonStringField } from "@/lib/http/api-route"
import {
  BillingRequiredError,
  observeCurrentUserDaytonaBillingInfo,
  pauseCurrentUserSandboxForBilling,
  requireCurrentUserInfraAccess,
} from "@/lib/billing/server"
import { resumeDaytonaSandbox } from "@/lib/daytona/sandbox"
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
    await requireCurrentUserInfraAccess()
    const info = await resumeDaytonaSandbox(sandboxId)
    await observeCurrentUserDaytonaBillingInfo(info)
    return NextResponse.json(info)
  } catch (error) {
    if (error instanceof BillingRequiredError) {
      await pauseCurrentUserSandboxForBilling(sandboxId)
      return jsonError(error.message, 402)
    }

    return jsonError(
      error instanceof Error ? error.message : "Failed to resume sandbox.",
      500
    )
  }
}
