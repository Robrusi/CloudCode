import { NextResponse } from "next/server"

import {
  BillingRequiredError,
  getStartedCurrentUserDaytonaSandbox,
} from "@/lib/billing/server"
import { jsonError, searchStringParam } from "@/lib/http/api-route"
import {
  readDaytonaFile,
  readDaytonaTextFile,
  resolveDaytonaPaths,
} from "@/lib/daytona/sandbox"

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
  const sandboxId = searchStringParam(request, "sandboxId")
  const relPath = searchParams.get("path")
  const format = searchParams.get("format")

  if (!sandboxId || !relPath) {
    return jsonError("sandboxId and path required", 400)
  }

  const cleaned = relPath.replace(/^\/+/, "")
  if (
    cleaned.includes("..") ||
    cleaned.startsWith("tmp/cloudcode-") ||
    cleaned.startsWith(".codex/") ||
    cleaned.includes("/.env")
  ) {
    return jsonError("invalid path", 400)
  }

  try {
    const { sandbox } = await getStartedCurrentUserDaytonaSandbox(sandboxId)
    const paths = await resolveDaytonaPaths(sandbox)
    const fullPath = `${paths.repoPath}/${cleaned}`
    const info = await sandbox.fs.getFileDetails(fullPath)

    if (format === "raw") {
      const contentType = getImageContentType(cleaned)
      if (!contentType) {
        return jsonError("raw preview is only supported for images", 415)
      }
      if (info.size > MAX_RAW_BYTES) {
        return jsonError(
          `Image too large (${info.size} bytes). Max ${MAX_RAW_BYTES} bytes.`,
          413,
          { size: info.size, tooLarge: true }
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
      return jsonError(
        `File too large (${info.size} bytes). Max ${MAX_BYTES} bytes.`,
        413,
        { size: info.size, tooLarge: true }
      )
    }

    return NextResponse.json({
      content: await readDaytonaTextFile(sandbox, fullPath),
      modifiedTime: info.modTime ?? null,
      path: cleaned,
      size: info.size,
    })
  } catch (error) {
    if (error instanceof BillingRequiredError) {
      return jsonError(error.message, 402)
    }

    return jsonError(
      error instanceof Error ? error.message : "Failed to read file",
      500
    )
  }
}
