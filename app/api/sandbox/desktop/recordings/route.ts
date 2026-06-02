import { NextResponse } from "next/server"

import {
  downloadDaytonaDesktopRecording,
  listDaytonaDesktopRecordings,
  startDaytonaDesktopRecording,
  stopDaytonaDesktopRecording,
} from "@/lib/daytona-desktop"
import { requireSameOrigin } from "@/lib/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox-authorization"

export const runtime = "nodejs"
export const maxDuration = 300

async function parseBody(request: Request) {
  try {
    return (await request.json()) as {
      action?: unknown
      label?: unknown
      recordingId?: unknown
      sandboxId?: unknown
    }
  } catch {
    return {}
  }
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function downloadName(fileName: string) {
  return fileName.replace(/["\r\n]/g, "_") || "desktop-recording.mp4"
}

function arrayBufferBody(bytes: Buffer) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

function videoResponse(
  bytes: Buffer,
  fileName: string,
  request: Request,
  inline: boolean
) {
  const disposition = inline ? "inline" : "attachment"
  const baseHeaders = {
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-disposition": `${disposition}; filename="${downloadName(fileName)}"`,
    "content-type": "video/mp4",
  }
  const range = request.headers.get("range")
  const match = range?.match(/^bytes=(\d*)-(\d*)$/)

  if (match) {
    const size = bytes.byteLength
    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Number(match[2]) : size - 1
    if (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end >= start &&
      start < size
    ) {
      const clampedEnd = Math.min(end, size - 1)
      const chunk = bytes.subarray(start, clampedEnd + 1)
      return new Response(arrayBufferBody(chunk), {
        headers: {
          ...baseHeaders,
          "content-length": String(chunk.byteLength),
          "content-range": `bytes ${start}-${clampedEnd}/${size}`,
        },
        status: 206,
      })
    }
  }

  return new Response(arrayBufferBody(bytes), {
    headers: {
      ...baseHeaders,
      "content-length": String(bytes.byteLength),
    },
  })
}

export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")
  const recordingId = searchParams.get("recordingId")
  const download = searchParams.get("download") === "1"
  const inline = searchParams.get("inline") === "1"

  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)

    if (recordingId && download) {
      const recording = await downloadDaytonaDesktopRecording(
        sandboxId,
        recordingId
      )
      return videoResponse(recording.bytes, recording.fileName, request, inline)
    }

    return NextResponse.json(await listDaytonaDesktopRecordings(sandboxId))
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Failed to read Daytona desktop recordings.",
      500
    )
  }
}

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const body = await parseBody(request)
  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : ""
  const action = typeof body.action === "string" ? body.action : ""
  const label = typeof body.label === "string" ? body.label : undefined
  const recordingId =
    typeof body.recordingId === "string" ? body.recordingId : ""

  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)

    if (action === "start") {
      return NextResponse.json(
        await startDaytonaDesktopRecording(sandboxId, { label })
      )
    }
    if (action === "stop") {
      if (!recordingId) return jsonError("recordingId required", 400)
      return NextResponse.json(
        await stopDaytonaDesktopRecording(sandboxId, { recordingId })
      )
    }

    return jsonError("invalid recording action", 400)
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Failed to update Daytona desktop recording.",
      500
    )
  }
}
