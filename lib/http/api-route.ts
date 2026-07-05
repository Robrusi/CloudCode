import { NextResponse } from "next/server"

import type { UnknownRecord } from "@/lib/shared/unknown-values"

export type JsonRecord = UnknownRecord

export async function readJsonRecord(request: Request): Promise<JsonRecord> {
  return (await readJsonRecordOrNull(request)) ?? {}
}

export async function readJsonRecordOrNull(
  request: Request
): Promise<JsonRecord | null> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as JsonRecord)
      : {}
  } catch {
    return null
  }
}

export function jsonBooleanField(body: JsonRecord, field: string) {
  const value = body[field]
  return typeof value === "boolean" ? value : undefined
}

export function jsonNumberField(body: JsonRecord, field: string) {
  const value = body[field]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function jsonStringField(body: JsonRecord, field: string) {
  const value = body[field]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function jsonRawStringField(body: JsonRecord, field: string) {
  const value = body[field]
  return typeof value === "string" ? value : undefined
}

export async function readJsonStringField(request: Request, field: string) {
  const body = await readJsonRecord(request)
  return jsonStringField(body, field)
}

export function searchStringParam(request: Request, field: string) {
  const value = new URL(request.url).searchParams.get(field)
  return value?.trim() || undefined
}

// Sandbox read endpoints wake (start/resume) a stopped sandbox by default.
// Background prefetches opt out with `wakeSandbox=0` so merely viewing a thread
// never resumes its sandbox.
export function searchWakeSandbox(request: Request) {
  return new URL(request.url).searchParams.get("wakeSandbox") !== "0"
}

export function jsonError(
  message: string,
  status: number,
  details?: Record<string, unknown>
) {
  return NextResponse.json({ error: message, ...details }, { status })
}

export function noStoreJson(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store, private",
      ...init?.headers,
    },
  })
}

export function noStoreJsonError(
  message: string,
  status: number,
  details?: Record<string, unknown>
) {
  return noStoreJson({ error: message, ...details }, { status })
}
