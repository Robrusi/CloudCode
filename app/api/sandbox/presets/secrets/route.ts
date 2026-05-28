import { ConvexHttpClient } from "convex/browser"
import { NextResponse } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getConvexAuthToken } from "@/lib/codex-auth"
import {
  getDaytonaSandbox,
  readDaytonaTextFile,
  resolveDaytonaPaths,
  runDaytonaCommand,
  writeDaytonaTextFile,
} from "@/lib/daytona-sandbox"
import { dedupeEnvVars, type ParsedEnvVar } from "@/lib/dotenv-parse"
import { requireSameOrigin } from "@/lib/request-security"
import { removeCloudcodeEnvLocalVars } from "@/lib/sandbox-env"
import { encryptSecret } from "@/lib/secret-crypto"

export const runtime = "nodejs"
export const maxDuration = 300

type SecretCleanupResult = {
  changed: boolean
  error?: string
  sandboxId: string
  skipped?: string
}

type PresetSecretSummary = {
  id: Id<"sandboxPresetSecrets">
  name: string
}

type PresetSummary = {
  environments?: Array<{
    activeSandboxId?: string
  }>
  id: Id<"sandboxPresets">
  secrets: PresetSecretSummary[]
}

type ChatSummary = {
  sandboxId?: string
  sandboxPresetId?: Id<"sandboxPresets">
  sandboxState?: string
}

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL

  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before using Convex storage.")
  }

  return url
}

async function convexClient() {
  const client = new ConvexHttpClient(getConvexUrl())
  client.setAuth(await getConvexAuthToken())
  return client
}

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store, private",
      ...init?.headers,
    },
  })
}

async function removeSecretFromSandboxEnvLocal(
  sandboxId: string,
  name: string
): Promise<SecretCleanupResult> {
  try {
    const sandbox = await getDaytonaSandbox(sandboxId)
    await sandbox.refreshData().catch(() => undefined)
    if (sandbox.state !== "started") {
      return {
        changed: false,
        sandboxId,
        skipped: `Sandbox is ${sandbox.state || "not running"}.`,
      }
    }

    const paths = await resolveDaytonaPaths(sandbox)
    const result = await removeCloudcodeEnvLocalVars(
      {
        readTextFile: (path) => readDaytonaTextFile(sandbox, path),
        runCommand: (command, options) =>
          runDaytonaCommand(sandbox, command, {
            cwd: paths.home,
            timeoutMs: options?.timeoutMs,
          }),
        writeTextFile: (path, content) =>
          writeDaytonaTextFile(sandbox, path, content),
      },
      paths.repoPath,
      [name]
    )

    return {
      changed: result.changed,
      sandboxId,
    }
  } catch (error) {
    return {
      changed: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update sandbox .env.local.",
      sandboxId,
    }
  }
}

function activeSandboxId(record: ChatSummary) {
  if (!record.sandboxId) return undefined
  if (
    record.sandboxState === "deleted" ||
    record.sandboxState === "error" ||
    record.sandboxState === "stopped"
  ) {
    return undefined
  }

  return record.sandboxId
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value)))
  )
}

async function secretRemovalPlan(
  client: ConvexHttpClient,
  secretId: Id<"sandboxPresetSecrets">
) {
  const [presets, chats] = await Promise.all([
    client.query(api.sandboxPresets.listWithEnvironments, {}),
    client.query(api.chats.list, {}),
  ])
  const preset = (presets as PresetSummary[]).find((candidate) =>
    candidate.secrets.some((secret) => secret.id === secretId)
  )
  const secret = preset?.secrets.find((candidate) => candidate.id === secretId)

  if (!preset || !secret) {
    throw new Error("Secret not found.")
  }

  return {
    name: secret.name,
    sandboxIds: uniqueStrings([
      ...(preset.environments ?? []).map(
        (environment) => environment.activeSandboxId
      ),
      ...(chats as ChatSummary[])
        .filter((chat) => chat.sandboxPresetId === preset.id)
        .map(activeSandboxId),
    ]),
  }
}

function parseSecretEntries(value: unknown): ParsedEnvVar[] | null {
  if (!Array.isArray(value)) return null

  const entries: ParsedEnvVar[] = []
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as { name?: unknown }).name !== "string" ||
      typeof (item as { value?: unknown }).value !== "string"
    ) {
      return null
    }
    entries.push({
      name: (item as { name: string }).name,
      value: (item as { value: string }).value,
    })
  }

  return entries
}

async function upsertSecrets(
  client: ConvexHttpClient,
  presetId: Id<"sandboxPresets">,
  entries: ParsedEnvVar[]
) {
  const saved: Array<{ id: Id<"sandboxPresetSecrets">; name: string }> = []
  const failed: Array<{ error: string; name: string }> = []

  for (const entry of entries) {
    try {
      const id = await client.mutation(api.sandboxPresets.upsertSecret, {
        name: entry.name,
        presetId,
        value: encryptSecret(entry.value),
      })
      saved.push({ id, name: entry.name })
    } catch (error) {
      failed.push({
        error:
          error instanceof Error ? error.message : "Failed to save secret.",
        name: entry.name,
      })
    }
  }

  return { failed, saved }
}

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = (await request.json()) as {
      name?: unknown
      presetId?: unknown
      secrets?: unknown
      value?: unknown
    }

    if (typeof body.presetId !== "string") {
      return json({ error: "presetId is required." }, { status: 400 })
    }
    const presetId = body.presetId as Id<"sandboxPresets">

    if (body.secrets !== undefined) {
      const entries = parseSecretEntries(body.secrets)
      if (!entries) {
        return json(
          { error: "secrets must be an array of { name, value } pairs." },
          { status: 400 }
        )
      }

      const deduped = dedupeEnvVars(entries)
      if (deduped.length === 0) {
        return json({ error: "No secrets to import." }, { status: 400 })
      }

      const client = await convexClient()
      const { failed, saved } = await upsertSecrets(client, presetId, deduped)
      return json({ failed, saved }, { status: failed.length ? 207 : 200 })
    }

    if (typeof body.name !== "string" || typeof body.value !== "string") {
      return json(
        { error: "presetId, name, and value are required." },
        { status: 400 }
      )
    }

    const client = await convexClient()
    const id = await client.mutation(api.sandboxPresets.upsertSecret, {
      name: body.name,
      presetId,
      value: encryptSecret(body.value),
    })

    return json({ id })
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save secret.",
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  const blocked = requireSameOrigin(request)
  if (blocked) return blocked

  try {
    const body = (await request.json().catch(() => null)) as {
      secretId?: unknown
    } | null

    if (typeof body?.secretId !== "string") {
      return json({ error: "secretId is required." }, { status: 400 })
    }

    const secretId = body.secretId as Id<"sandboxPresetSecrets">
    const client = await convexClient()
    let cleanup: SecretCleanupResult[] = []
    let cleanupError: string | undefined

    try {
      const plan = await secretRemovalPlan(client, secretId)
      cleanup = await Promise.all(
        plan.sandboxIds.map((sandboxId) =>
          removeSecretFromSandboxEnvLocal(sandboxId, plan.name)
        )
      )
    } catch (error) {
      cleanupError =
        error instanceof Error
          ? error.message
          : "Unable to prepare sandbox .env.local cleanup."
    }

    await client.mutation(api.sandboxPresets.removeSecret, {
      secretId,
    })

    return json({
      cleanup,
      ...(cleanupError ? { cleanupError } : {}),
      ok: true,
    })
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete secret.",
      },
      { status: 500 }
    )
  }
}
