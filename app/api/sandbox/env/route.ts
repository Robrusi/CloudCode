import { NextResponse } from "next/server"

import {
  getStartedDaytonaSandbox,
  readDaytonaTextFile,
  resolveDaytonaPaths,
  writeDaytonaTextFile,
} from "@/lib/daytona-sandbox"
import { CLOUDCODE_ENV_END, CLOUDCODE_ENV_START } from "@/lib/sandbox-env"

export const runtime = "nodejs"

type EnvVar = { name: string; value: string }

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function splitManagedBlock(content: string): {
  managedBlock: string | null
  userContent: string
} {
  const startIdx = content.indexOf(CLOUDCODE_ENV_START)
  if (startIdx === -1) return { managedBlock: null, userContent: content }
  const endIdx = content.indexOf(CLOUDCODE_ENV_END, startIdx)
  if (endIdx === -1) return { managedBlock: null, userContent: content }
  const blockEnd = endIdx + CLOUDCODE_ENV_END.length
  return {
    managedBlock: content.slice(startIdx, blockEnd),
    userContent: content.slice(0, startIdx) + content.slice(blockEnd),
  }
}

function unquoteValue(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0]
    const last = raw[raw.length - 1]
    if (first === '"' && last === '"') {
      try {
        return JSON.parse(raw) as string
      } catch {
        return raw.slice(1, -1)
      }
    }
    if (first === "'" && last === "'") return raw.slice(1, -1)
  }
  return raw
}

function parseEntries(userContent: string): EnvVar[] {
  const entries: EnvVar[] = []
  for (const rawLine of userContent.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const name = line.slice(0, eq).trim()
    if (!ENV_NAME_PATTERN.test(name)) continue
    entries.push({ name, value: unquoteValue(line.slice(eq + 1).trim()) })
  }
  return entries
}

function serialize(entries: EnvVar[], managedBlock: string | null): string {
  const userText = entries
    .map((e) => `${e.name}=${JSON.stringify(e.value)}`)
    .join("\n")
  if (managedBlock) {
    return `${userText ? `${userText}\n\n` : ""}${managedBlock}\n`
  }
  return userText ? `${userText}\n` : ""
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")
  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }
  try {
    const sandbox = await getStartedDaytonaSandbox(sandboxId)
    const paths = await resolveDaytonaPaths(sandbox)
    const fullPath = `${paths.repoPath}/.env.local`
    let content = ""
    try {
      content = await readDaytonaTextFile(sandbox, fullPath)
    } catch {
      content = ""
    }
    const { userContent } = splitManagedBlock(content)
    return NextResponse.json({ entries: parseEntries(userContent) })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to read .env.local",
      },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    entries?: unknown
    sandboxId?: unknown
  } | null
  const sandboxId =
    typeof body?.sandboxId === "string" ? body.sandboxId : undefined
  const rawEntries = Array.isArray(body?.entries) ? body.entries : null
  if (!sandboxId || !rawEntries) {
    return NextResponse.json(
      { error: "sandboxId and entries required" },
      { status: 400 }
    )
  }
  const entries: EnvVar[] = []
  const seen = new Set<string>()
  for (const item of rawEntries) {
    if (
      !item ||
      typeof (item as EnvVar).name !== "string" ||
      typeof (item as EnvVar).value !== "string"
    ) {
      return NextResponse.json({ error: "invalid entry" }, { status: 400 })
    }
    const name = (item as EnvVar).name.trim()
    const value = (item as EnvVar).value
    if (!ENV_NAME_PATTERN.test(name)) {
      return NextResponse.json(
        { error: `Invalid variable name: ${name || "(empty)"}` },
        { status: 400 }
      )
    }
    if (seen.has(name)) {
      return NextResponse.json(
        { error: `Duplicate variable: ${name}` },
        { status: 400 }
      )
    }
    seen.add(name)
    entries.push({ name, value })
  }
  try {
    const sandbox = await getStartedDaytonaSandbox(sandboxId)
    const paths = await resolveDaytonaPaths(sandbox)
    const fullPath = `${paths.repoPath}/.env.local`
    let existing = ""
    try {
      existing = await readDaytonaTextFile(sandbox, fullPath)
    } catch {
      existing = ""
    }
    const { managedBlock } = splitManagedBlock(existing)
    await writeDaytonaTextFile(
      sandbox,
      fullPath,
      serialize(entries, managedBlock)
    )
    return NextResponse.json({ entries, ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to write .env.local",
      },
      { status: 500 }
    )
  }
}
