import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getConvexAuthToken } from "@/lib/codex-auth"
import { decryptSecret } from "@/lib/secret-crypto"

export type SandboxPresetForRun = {
  cpuCount: number
  customToolingCommands: string[]
  id: Id<"sandboxPresets">
  installScript?: string
  memoryMB: number
  name: string
  secrets: Array<{
    name: string
    value: string
  }>
  toolVersions: Array<{
    tool: string
    version: string
  }>
  tools: string[]
}

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL

  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before using Convex storage.")
  }

  return url
}

export async function getSandboxPresetForRun(presetId?: string) {
  const trimmed = presetId?.trim()
  if (!trimmed) return undefined

  const client = new ConvexHttpClient(getConvexUrl())
  client.setAuth(await getConvexAuthToken())

  const preset = await client.query(api.sandboxPresets.getForRun, {
    presetId: trimmed as Id<"sandboxPresets">,
  })

  if (!preset) {
    throw new Error("Sandbox preset not found.")
  }

  return {
    ...preset,
    secrets: preset.secrets.map((secret) => ({
      name: secret.name,
      value: decryptSecret(secret.value),
    })),
  } satisfies SandboxPresetForRun
}
