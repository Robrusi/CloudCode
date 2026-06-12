import {
  BillingRequiredError,
  observeCurrentUserDaytonaBillingInfo,
  pauseCurrentUserSandboxForBilling,
  requireCurrentUserInfraAccess,
} from "@/lib/billing/server"
import { takeDaytonaDesktopScreenshot } from "@/lib/daytona/desktop"
import { jsonError, searchStringParam } from "@/lib/http/api-route"
import { readDaytonaSandboxInfo } from "@/lib/daytona/sandbox"
import { requireSameOrigin } from "@/lib/http/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox/authorization"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const sandboxId = searchStringParam(request, "sandboxId")

  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    await requireCurrentUserInfraAccess()
    const screenshot = await takeDaytonaDesktopScreenshot(sandboxId)
    await readDaytonaSandboxInfo(sandboxId)
      .then(observeCurrentUserDaytonaBillingInfo)
      .catch((error) => {
        console.warn("Unable to observe screenshot sandbox billing.", error)
      })
    const base64 = screenshot.screenshot?.replace(
      /^data:image\/[a-z0-9.+-]+;base64,/i,
      ""
    )

    if (!base64) {
      return jsonError("No screenshot returned by Daytona.", 502)
    }

    const bytes = Buffer.from(base64, "base64")
    return new Response(bytes, {
      headers: {
        "cache-control": "no-store",
        "content-length": String(bytes.byteLength),
        "content-type": "image/png",
      },
    })
  } catch (error) {
    if (error instanceof BillingRequiredError) {
      await pauseCurrentUserSandboxForBilling(sandboxId)
      return jsonError(error.message, 402)
    }

    return jsonError(
      error instanceof Error
        ? error.message
        : "Failed to capture Daytona desktop screenshot.",
      500
    )
  }
}
