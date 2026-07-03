import {
  BillingRequiredError,
  pauseCurrentUserSandboxForBilling,
  requireCurrentUserInfraAccess,
} from "@/lib/billing/server"
import { DaytonaSandboxNotRunningError } from "@/lib/daytona/sandbox"
import { jsonError } from "@/lib/http/api-route"
import { requireCurrentUserSandbox } from "@/lib/sandbox/authorization"

export function numberParam(
  value: string | null | undefined,
  fallback: number
) {
  if (!value) return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function terminalRequiredResponse() {
  return jsonError("sandboxId and terminalId required", 400)
}

export function terminalOperationErrorResponse(
  error: unknown,
  fallback: string
) {
  if (error instanceof DaytonaSandboxNotRunningError) {
    return jsonError(error.message, 409)
  }

  return jsonError(error instanceof Error ? error.message : fallback, 500)
}

export async function requireTerminalAccess(sandboxId: string) {
  const [sandboxAccessResult, infraAccessResult] = await Promise.allSettled([
    requireCurrentUserSandbox(sandboxId),
    requireCurrentUserInfraAccess(),
  ])

  if (sandboxAccessResult.status === "rejected") {
    return { response: jsonError("Sandbox not found.", 404) }
  }

  if (infraAccessResult.status === "rejected") {
    const error = infraAccessResult.reason
    if (error instanceof BillingRequiredError) {
      await pauseCurrentUserSandboxForBilling(sandboxId)
      return { response: jsonError(error.message, 402) }
    }

    return { response: jsonError("Sandbox not found.", 404) }
  }

  return { sandboxAccess: sandboxAccessResult.value }
}
