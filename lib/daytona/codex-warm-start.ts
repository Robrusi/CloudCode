import { createHash } from "node:crypto"

import type { RunCodexInSandboxInput } from "@/lib/daytona/codex-agent-types"
import type { DaytonaSandboxPaths } from "@/lib/daytona/sandbox"

const CODEX_WARM_START_VERSION = "2"

type CodexWarmStartVersions = {
  cli: string
  contextTool: string
  daemon: string
  desktopTool: string
  factoryTool: string
  githubTool: string
  skills: string
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== "object") return value ?? null

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, stableValue(entryValue)])
  )
}

/**
 * Fingerprints only state that affects the prepared sandbox. Per-turn values
 * such as the prompt, run id, auth payload, and Codex thread id deliberately
 * do not participate: changing them must not turn a warm sandbox into a cold
 * setup path.
 */
export function codexWarmStartFingerprint({
  baseBranch,
  contextConfig,
  desktopInstructions,
  input,
  mcpConfig,
  paths,
  repoUrl,
  requestedBranchName,
  useBaseBranch,
  versions,
}: {
  baseBranch?: string
  contextConfig: string
  desktopInstructions: string
  input: RunCodexInSandboxInput
  mcpConfig: string
  paths: DaytonaSandboxPaths
  repoUrl: string
  requestedBranchName?: string
  useBaseBranch: boolean
  versions: CodexWarmStartVersions
}) {
  const state = stableValue({
    baseBranch,
    branchMode: input.branchMode ?? "auto",
    contextConfig,
    desktopInstructions,
    mcpConfig,
    paths: {
      codexHome: paths.codexHome,
      codexLauncherPath: paths.codexLauncherPath,
      home: paths.home,
      presetEnvPath: paths.presetEnvPath,
      repoPath: paths.repoPath,
      runtimeHome: paths.runtimeHome,
    },
    prNumber: input.prNumber ?? null,
    requestedBranchName,
    sandboxPreset: input.sandboxPreset ?? null,
    threadId: input.threadId ?? null,
    useBaseBranch,
    versions,
  })

  return createHash("sha256")
    .update(
      [CODEX_WARM_START_VERSION, repoUrl, JSON.stringify(state)].join("\0")
    )
    .digest("hex")
}
