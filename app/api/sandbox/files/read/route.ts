import { NextResponse } from "next/server"

import { withReadableSandbox } from "@/lib/e2b-sandbox-files"
import { refreshSandboxInactivityTimeout } from "@/lib/e2b-sandbox-timeout"

export const runtime = "nodejs"

const REPO_PATH = "/home/user/repo"
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB cap for inline editing
const MAX_RAW_BYTES = 25 * 1024 * 1024 // 25 MB cap for image previewing

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
}

function getImageContentType(path: string) {
  const ext = path.split(".").pop()?.toLowerCase()
  return ext ? IMAGE_CONTENT_TYPES[ext] : undefined
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")
  const snapshotId = searchParams.get("snapshotId")
  const relPath = searchParams.get("path")
  const format = searchParams.get("format")

  if ((!sandboxId && !snapshotId) || !relPath) {
    return NextResponse.json(
      { error: "sandboxId or snapshotId, and path required" },
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
    return await withReadableSandbox(
      { sandboxId, snapshotId },
      async (sandbox, source) => {
        if (source === "sandbox") {
          await refreshSandboxInactivityTimeout(sandbox)
        }
        const info = await sandbox.files.getInfo(fullPath)
        if (format === "raw") {
          const contentType = getImageContentType(cleaned)
          if (!contentType) {
            return NextResponse.json(
              { error: "raw preview is only supported for images" },
              { status: 415 }
            )
          }
          if (info.size > MAX_RAW_BYTES) {
            return NextResponse.json(
              {
                error: `Image too large (${info.size} bytes). Max ${MAX_RAW_BYTES} bytes.`,
                tooLarge: true,
                size: info.size,
              },
              { status: 413 }
            )
          }

          const bytes = await sandbox.files.read(fullPath, { format: "bytes" })
          const body = new ArrayBuffer(bytes.byteLength)
          new Uint8Array(body).set(bytes)
          return new NextResponse(new Blob([body], { type: contentType }), {
            headers: {
              "Cache-Control": "no-store",
              "Content-Length": String(info.size),
              "Content-Type": contentType,
            },
          })
        }

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
        return NextResponse.json(
          {
            path: cleaned,
            content,
            size: info.size,
            modifiedTime:
              info.modifiedTime instanceof Date
                ? info.modifiedTime.toISOString()
                : info.modifiedTime ?? null,
          }
        )
      }
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to read file",
      },
      { status: 500 }
    )
  }
}
