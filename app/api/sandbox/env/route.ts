import type { Sandbox } from "@daytona/sdk"

import {
  BillingRequiredError,
  getStartedCurrentUserDaytonaSandbox,
} from "@/lib/billing/server"
import {
  jsonStringField,
  noStoreJson,
  noStoreJsonError,
  readJsonRecord,
  searchStringParam,
} from "@/lib/http/api-route"
import {
  getStartedDaytonaSandbox,
  readDaytonaTextFile,
  resolveDaytonaPaths,
  writeDaytonaTextFile,
} from "@/lib/daytona/sandbox"
import { requireSameOrigin } from "@/lib/http/request-security"
import { requireCurrentUserSandbox } from "@/lib/sandbox/authorization"
import {
  CLOUDCODE_ENV_END,
  CLOUDCODE_ENV_START,
  type SandboxEnvVar,
} from "@/lib/sandbox/env"

export const runtime = "nodejs"

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const envPathCache = new Map<string, string>()

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

function parseEntries(userContent: string): SandboxEnvVar[] {
  const entries: SandboxEnvVar[] = []

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

function serialize(
  entries: SandboxEnvVar[],
  managedBlock: string | null
): string {
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

async function readEnvFile(sandboxId: string, providedSandbox?: Sandbox) {
  const sandbox = providedSandbox ?? (await getStartedDaytonaSandbox(sandboxId))
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

function validateEntries(rawEntries: unknown): SandboxEnvVar[] | Response {
  if (!Array.isArray(rawEntries)) {
    return noStoreJsonError("entries required", 400)
  }

  const entries: SandboxEnvVar[] = []
  const seen = new Set<string>()

  for (const item of rawEntries) {
    if (
      !item ||
      typeof (item as SandboxEnvVar).name !== "string" ||
      typeof (item as SandboxEnvVar).value !== "string"
    ) {
      return noStoreJsonError("invalid entry", 400)
    }

    const name = (item as SandboxEnvVar).name.trim()
    const value = (item as SandboxEnvVar).value

    if (!ENV_NAME_PATTERN.test(name)) {
      return noStoreJsonError(
        `Invalid variable name: ${name || "(empty)"}`,
        400
      )
    }

    if (seen.has(name)) {
      return noStoreJsonError(`Duplicate variable: ${name}`, 400)
    }

    seen.add(name)
    entries.push({ name, value })
  }

  return entries
}

export async function GET(request: Request) {
  const sandboxId = searchStringParam(request, "sandboxId")

  if (!sandboxId) {
    return noStoreJsonError("sandboxId required", 400)
  }

  try {
    const { sandbox } = await getStartedCurrentUserDaytonaSandbox(sandboxId)
    const { content } = await readEnvFile(sandboxId, sandbox)
    const { userContent } = splitManagedBlock(content)
    return noStoreJson({ entries: parseEntries(userContent) })
  } catch (error) {
    if (error instanceof BillingRequiredError) {
      return noStoreJsonError(error.message, 402)
    }

    return noStoreJsonError(
      error instanceof Error ? error.message : "Failed to read .env.local",
      500
    )
  }
}

async function save(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  const body = await readJsonRecord(request)
  const sandboxId = jsonStringField(body, "sandboxId")

  if (!sandboxId) {
    return noStoreJsonError("sandboxId required", 400)
  }

  const entries = validateEntries(body.entries)
  if (entries instanceof Response) return entries

  try {
    await requireCurrentUserSandbox(sandboxId)
    const { sandbox } = await getStartedCurrentUserDaytonaSandbox(sandboxId)
    const { content, fullPath } = await readEnvFile(sandboxId, sandbox)
    const { managedBlock } = splitManagedBlock(content)

    await writeDaytonaTextFile(
      sandbox,
      fullPath,
      serialize(entries, managedBlock)
    )

    return noStoreJson({ entries, ok: true })
  } catch (error) {
    if (error instanceof BillingRequiredError) {
      return noStoreJsonError(error.message, 402)
    }

    return noStoreJsonError(
      error instanceof Error ? error.message : "Failed to write .env.local",
      500
    )
  }
}

export async function POST(request: Request) {
  return await save(request)
}

export async function PUT(request: Request) {
  return await save(request)
}
