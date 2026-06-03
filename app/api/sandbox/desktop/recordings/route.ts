import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

import { NextResponse } from "next/server"

import {
  getDaytonaDesktopRecordingFile,
  listDaytonaDesktopRecordings,
  startDaytonaDesktopRecording,
  stopDaytonaDesktopRecording,
  type DaytonaDesktopRecordingFile,
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

function parseRangeHeader(range: string | null, size: number) {
  const match = range?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return "unsatisfiable" as const

  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isInteger(suffixLength) || suffixLength < 1) {
      return "unsatisfiable" as const
    }
    return {
      end: size - 1,
      start: Math.max(size - suffixLength, 0),
    }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : size - 1
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "unsatisfiable" as const
  }

  return {
    end: Math.min(end, size - 1),
    start,
  }
}

function fileStreamBody(filePath: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(filePath, { end, start })) as BodyInit
}

function videoResponse(
  recording: DaytonaDesktopRecordingFile,
  request: Request,
  inline: boolean
) {
  const disposition = inline ? "inline" : "attachment"
  const size = recording.sizeBytes
  const baseHeaders = {
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "content-disposition": `${disposition}; filename="${downloadName(recording.fileName)}"`,
    "content-type": "video/mp4",
  }
  const range = parseRangeHeader(request.headers.get("range"), size)

  if (range === "unsatisfiable") {
    return new Response(null, {
      headers: {
        ...baseHeaders,
        "content-range": `bytes */${size}`,
      },
      status: 416,
    })
  }

  if (range) {
    return new Response(
      fileStreamBody(recording.filePath, range.start, range.end),
      {
        headers: {
          ...baseHeaders,
          "content-length": String(range.end - range.start + 1),
          "content-range": `bytes ${range.start}-${range.end}/${size}`,
        },
        status: 206,
      }
    )
  }

  return new Response(fileStreamBody(recording.filePath), {
    headers: {
      ...baseHeaders,
      "content-length": String(size),
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
      const recording = await getDaytonaDesktopRecordingFile(
        sandboxId,
        recordingId
      )
      return videoResponse(recording, request, inline)
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
