import { NextResponse } from "next/server"
import type { Sandbox } from "@daytona/sdk"

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
const envPathCache = new Map<string, string>()

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store, private",
      ...init?.headers,
    },
  })
}

function sameOriginRequest(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) return true

  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

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
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const line = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed
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
    .map((entry) => `${entry.name}=${JSON.stringify(entry.value)}`)
    .join("\n")

  if (managedBlock) {
    return `${userText ? `${userText}\n\n` : ""}${managedBlock}\n`
  }

  return userText ? `${userText}\n` : ""
}

async function getEnvPath(sandboxId: string, sandbox: Sandbox) {
  const cached = envPathCache.get(sandboxId)
  if (cached) return cached

  const paths = await resolveDaytonaPaths(sandbox)
  const fullPath = `${paths.repoPath}/.env.local`
  envPathCache.set(sandboxId, fullPath)
  return fullPath
}

async function readEnvFile(sandboxId: string) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  const fullPath = await getEnvPath(sandboxId, sandbox)

  try {
    return {
      content: await readDaytonaTextFile(sandbox, fullPath),
      fullPath,
      sandbox,
    }
  } catch {
    return { content: "", fullPath, sandbox }
  }
}

function validateEntries(rawEntries: unknown): EnvVar[] | Response {
  if (!Array.isArray(rawEntries)) {
    return json({ error: "entries required" }, { status: 400 })
  }

  const entries: EnvVar[] = []
  const seen = new Set<string>()

  for (const item of rawEntries) {
    if (
      !item ||
      typeof (item as EnvVar).name !== "string" ||
      typeof (item as EnvVar).value !== "string"
    ) {
      return json({ error: "invalid entry" }, { status: 400 })
    }

    const name = (item as EnvVar).name.trim()
    const value = (item as EnvVar).value

    if (!ENV_NAME_PATTERN.test(name)) {
      return json(
        { error: `Invalid variable name: ${name || "(empty)"}` },
        { status: 400 }
      )
    }

    if (seen.has(name)) {
      return json({ error: `Duplicate variable: ${name}` }, { status: 400 })
    }

    seen.add(name)
    entries.push({ name, value })
  }

  return entries
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")

  if (!sandboxId) {
    return json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    const { content } = await readEnvFile(sandboxId)
    const { userContent } = splitManagedBlock(content)
    return json({ entries: parseEntries(userContent) })
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Failed to read .env.local",
      },
      { status: 500 }
    )
  }
}

async function save(request: Request) {
  if (!sameOriginRequest(request)) {
    return json({ error: "Cross-origin request blocked" }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    entries?: unknown
    sandboxId?: unknown
  } | null
  const sandboxId =
    typeof body?.sandboxId === "string" ? body.sandboxId : undefined

  if (!sandboxId) {
    return json({ error: "sandboxId required" }, { status: 400 })
  }

  const entries = validateEntries(body?.entries)
  if (entries instanceof Response) return entries

  try {
    const { content, fullPath, sandbox } = await readEnvFile(sandboxId)
    const { managedBlock } = splitManagedBlock(content)

    await writeDaytonaTextFile(
      sandbox,
      fullPath,
      serialize(entries, managedBlock)
    )

    return json({ entries, ok: true })
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Failed to write .env.local",
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  return await save(request)
}

export async function PUT(request: Request) {
  return await save(request)
}
