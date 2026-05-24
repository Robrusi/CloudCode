import { NextResponse } from "next/server"

import {
  getStartedDaytonaSandbox,
  readDaytonaFile,
  readDaytonaTextFile,
  resolveDaytonaPaths,
} from "@/lib/daytona-sandbox"
import { requireCurrentUserSandbox } from "@/lib/sandbox-authorization"

export const runtime = "nodejs"

const MAX_BYTES = 2 * 1024 * 1024
const MAX_RAW_BYTES = 25 * 1024 * 1024

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
  const relPath = searchParams.get("path")
  const format = searchParams.get("format")

  if (!sandboxId || !relPath) {
    return NextResponse.json(
      { error: "sandboxId and path required" },
      { status: 400 }
    )
  }

  const cleaned = relPath.replace(/^\/+/, "")
  if (
    cleaned.includes("..") ||
    cleaned.startsWith("tmp/cloudcode-") ||
    cleaned.startsWith(".codex/") ||
    cleaned.includes("/.env")
  ) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 })
  }

  try {
    await requireCurrentUserSandbox(sandboxId)
    const sandbox = await getStartedDaytonaSandbox(sandboxId)
    const paths = await resolveDaytonaPaths(sandbox)
    const fullPath = `${paths.repoPath}/${cleaned}`
    const info = await sandbox.fs.getFileDetails(fullPath)

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
            size: info.size,
            tooLarge: true,
          },
          { status: 413 }
        )
      }

      const bytes = await readDaytonaFile(sandbox, fullPath)
      const body = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(body).set(bytes)
      return new NextResponse(body, {
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
          size: info.size,
          tooLarge: true,
        },
        { status: 413 }
      )
    }

    return NextResponse.json({
      content: await readDaytonaTextFile(sandbox, fullPath),
      modifiedTime: info.modTime ?? null,
      path: cleaned,
      size: info.size,
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
