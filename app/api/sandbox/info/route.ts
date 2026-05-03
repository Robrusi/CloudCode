import { Sandbox } from "e2b"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    const info = await Sandbox.getInfo(sandboxId)
    return NextResponse.json({
      sandboxId,
      state: info.state,
      startedAt: info.startedAt instanceof Date
        ? info.startedAt.getTime()
        : new Date(info.startedAt).getTime(),
      endAt: info.endAt instanceof Date
        ? info.endAt.getTime()
        : new Date(info.endAt).getTime(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Sandbox not found",
        notFound: true,
      },
      { status: 404 }
    )
  }
}
