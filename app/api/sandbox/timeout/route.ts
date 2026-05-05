import { Sandbox } from "e2b"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

const MIN_TIMEOUT_MS = 1_000

function serializeInfo(
  sandboxId: string,
  info: Awaited<ReturnType<typeof Sandbox.getInfo>>
) {
  return {
    sandboxId,
    state: info.state,
    startedAt:
      info.startedAt instanceof Date
        ? info.startedAt.getTime()
        : new Date(info.startedAt).getTime(),
    endAt:
      info.endAt instanceof Date
        ? info.endAt.getTime()
        : new Date(info.endAt).getTime(),
  }
}

export async function POST(request: Request) {
  let sandboxId: string | undefined
  let timeoutMs: number | undefined

  try {
    const body = (await request.json()) as {
      sandboxId?: unknown
      timeoutMs?: unknown
    }
    if (typeof body.sandboxId === "string") sandboxId = body.sandboxId
    if (typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs)) {
      timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.round(body.timeoutMs))
    }
  } catch {
    // ignore
  }

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }
  if (timeoutMs === undefined) {
    return NextResponse.json({ error: "timeoutMs required" }, { status: 400 })
  }

  try {
    const sandbox = await Sandbox.connect(sandboxId)
    await sandbox.setTimeout(timeoutMs)
    const info = await Sandbox.getInfo(sandboxId)
    return NextResponse.json(serializeInfo(sandboxId, info))
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update sandbox timeout",
      },
      { status: 500 }
    )
  }
}
