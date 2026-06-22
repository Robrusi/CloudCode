import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

import { NextResponse } from "next/server"

import {
  BillingRequiredError,
  getStartedCurrentUserDaytonaSandbox,
  pauseCurrentUserSandboxForBilling,
} from "@/lib/billing/server"
import {
  getCachedDaytonaDesktopRecordingFile,
  getDaytonaDesktopRecordingFile,
  isDaytonaDesktopSandboxRunning,
  listDaytonaDesktopRecordings,
  startDaytonaDesktopRecording,
  stopDaytonaDesktopRecording,
  type DaytonaDesktopRecordingFile,
} from "@/lib/daytona/desktop"
import {
  jsonError,
  jsonStringField,
  readJsonRecord,
  searchStringParam,
} from "@/lib/http/api-route"
import { requireSameOrigin } from "@/lib/http/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox/authorization"

export const runtime = "nodejs"
export const maxDuration = 300

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

function recordingDownloadPath(sandboxId: string, recordingId: string) {
  return `/api/sandbox/desktop/recordings?${new URLSearchParams({
    download: "1",
    inline: "1",
    recordingId,
    sandboxId,
  })}`
}

export async function GET(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const { searchParams } = new URL(request.url)
  const sandboxId = searchStringParam(request, "sandboxId")
  const recordingId = searchStringParam(request, "recordingId")
  const download = searchParams.get("download") === "1"
  const inline = searchParams.get("inline") === "1"
  const status = searchParams.get("status") === "1"

  if (!sandboxId) {
    return jsonError("sandboxId required", 400)
  }

  try {
    await requireCurrentUserSandbox(sandboxId)

    if (recordingId && status) {
      const recording = await getCachedDaytonaDesktopRecordingFile(
        sandboxId,
        recordingId
      )
      if (!recording) {
        // Report whether the sandbox is already running so the client can
        // auto-load (and cache) the recording without starting a stopped
        // sandbox. Only runs on a cache miss to keep the check cheap.
        const running = await isDaytonaDesktopSandboxRunning(sandboxId)
        return NextResponse.json({ cached: false, running })
      }

      return NextResponse.json({
        cached: true,
        fileName: recording.fileName,
        sizeBytes: recording.sizeBytes,
        url: recordingDownloadPath(sandboxId, recordingId),
      })
    }

    if (recordingId && download) {
      const recording = await getCachedDaytonaDesktopRecordingFile(
        sandboxId,
        recordingId
      )
      if (!recording) {
        return jsonError("Recording is not loaded yet.", 409, {
          needsMaterialize: true,
        })
      }
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

  const body = await readJsonRecord(request)
  const sandboxId = jsonStringField(body, "sandboxId")
  const action = jsonStringField(body, "action")
  const label = jsonStringField(body, "label")
  const recordingId = jsonStringField(body, "recordingId")

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
    if (action === "materialize") {
      if (!recordingId) return jsonError("recordingId required", 400)
      const cached = await getCachedDaytonaDesktopRecordingFile(
        sandboxId,
        recordingId
      )
      if (cached) {
        return NextResponse.json({
          fileName: cached.fileName,
          ok: true,
          recordingId,
          sizeBytes: cached.sizeBytes,
        })
      }

      const { sandbox } = await getStartedCurrentUserDaytonaSandbox(sandboxId)
      const recording = await getDaytonaDesktopRecordingFile(
        sandboxId,
        recordingId,
        { sandbox }
      )
      return NextResponse.json({
        fileName: recording.fileName,
        ok: true,
        recordingId,
        sizeBytes: recording.sizeBytes,
      })
    }

    return jsonError("invalid recording action", 400)
  } catch (error) {
    if (error instanceof BillingRequiredError) {
      await pauseCurrentUserSandboxForBilling(sandboxId)
      return jsonError(error.message, 402)
    }

    return jsonError(
      error instanceof Error
        ? error.message
        : "Failed to update Daytona desktop recording.",
      500
    )
  }
}
