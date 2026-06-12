import { NextResponse } from "next/server"

import { jsonError, searchStringParam } from "@/lib/http/api-route"
import { readDaytonaSandboxInfo } from "@/lib/daytona/sandbox"
import { requireCurrentUserSandbox } from "@/lib/sandbox/authorization"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const sandboxId = searchStringParam(request, "sandboxId")

  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    return NextResponse.json(await readDaytonaSandboxInfo(sandboxId))
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Sandbox not found",
      404,
      { notFound: true }
    )
  }
}
