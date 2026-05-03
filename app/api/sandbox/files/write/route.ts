import { Sandbox } from "e2b"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

const REPO_PATH = "/home/user/repo"
const MAX_BYTES = 2 * 1024 * 1024

export async function POST(request: Request) {
  let body: { sandboxId?: unknown; path?: unknown; content?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : null
  const relPath = typeof body.path === "string" ? body.path : null
  const content = typeof body.content === "string" ? body.content : null

  if (!sandboxId || !relPath || content === null) {
    return NextResponse.json(
      { error: "sandboxId, path, and content required" },
      { status: 400 }
    )
  }

  const cleaned = relPath.replace(/^\/+/, "")
  if (cleaned.includes("..")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 })
  }

  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) {
    return NextResponse.json(
      { error: `Content exceeds ${MAX_BYTES} bytes` },
      { status: 413 }
    )
  }

  const fullPath = `${REPO_PATH}/${cleaned}`

  try {
    const sandbox = await Sandbox.connect(sandboxId)
    const info = await sandbox.files.write(fullPath, content)
    return NextResponse.json({
      path: cleaned,
      written: true,
      info,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to write file",
      },
      { status: 500 }
    )
  }
}
