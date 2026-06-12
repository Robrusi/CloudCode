import { NextResponse } from "next/server"

import { jsonError, readJsonStringField } from "@/lib/http/api-route"
import { observeCurrentUserDaytonaBilling } from "@/lib/billing/server"
import {
  deleteDaytonaSandboxQuietly,
  readDaytonaSandboxInfo,
} from "@/lib/daytona/sandbox"
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
  } catch {
    return jsonError("Sandbox not found.", 404)
  }

  const info = await readDaytonaSandboxInfo(sandboxId).catch(() => null)
  if (info) {
    await observeCurrentUserDaytonaBilling({
      resources: {
        cpu: info.cpu,
        diskGiB: info.diskGiB,
        memoryGiB: info.memoryGiB,
      },
      sandboxId,
      state: "deleted",
    }).catch((error) => {
      console.warn("Unable to observe deleted sandbox billing.", error)
    })
  }

  await deleteDaytonaSandboxQuietly(sandboxId)

  return NextResponse.json({
    deleted: true,
    sandboxId,
  })
}
