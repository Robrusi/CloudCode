import { Sandbox } from "e2b"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

const REPO_PATH = "/home/user/repo"
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB cap for inline editing

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")
  const relPath = searchParams.get("path")

  if (!sandboxId || !relPath) {
    return NextResponse.json(
      { error: "sandboxId and path required" },
      { status: 400 }
    )
  }

  // Disallow path traversal escape outside repo root.
  const cleaned = relPath.replace(/^\/+/, "")
  if (cleaned.includes("..")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 })
  }

  const fullPath = `${REPO_PATH}/${cleaned}`

  try {
    const sandbox = await Sandbox.connect(sandboxId)
    const info = await sandbox.files.getInfo(fullPath)
    if (info.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `File too large (${info.size} bytes). Max ${MAX_BYTES} bytes.`,
          tooLarge: true,
          size: info.size,
        },
        { status: 413 }
      )
    }
    const content = await sandbox.files.read(fullPath, { format: "text" })
    return NextResponse.json({
      path: cleaned,
      content,
      size: info.size,
      modifiedTime:
        info.modifiedTime instanceof Date
          ? info.modifiedTime.toISOString()
          : info.modifiedTime ?? null,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to read file",
      },
      { status: 500 }
    )
  }
}
