import { createHash } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import { compactLine } from "@/lib/shared/compact-line"
import {
  linkSandboxPathToolsCommand,
  sandboxInstallEnv,
} from "@/lib/daytona/codex-runtime"
import {
  daytonaTerminalPath,
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"
import type { CodexRunLog } from "@/lib/codex/run-log"
import type { SandboxPresetEnvVar } from "@/lib/sandbox/env"
import type { SandboxGitHubAuth } from "@/lib/sandbox/github-auth"

const PRESET_INSTALL_TIMEOUT_MS = 10 * 60 * 1000

type PresetScriptInput = {
  onLog?: (log: CodexRunLog) => void | Promise<void>
  sandboxPreset?: {
    installScript?: string
    name?: string
    pathInstallScript?: string
    secrets: SandboxPresetEnvVar[]
  }
  signal?: AbortSignal
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

async function sandboxMarkerMatches(
  sandbox: Sandbox,
  markerPath: string,
  expected: string,
  signal?: AbortSignal
) {
  try {
    const result = await runDaytonaCommand(
      sandbox,
      `[ -s ${shellQuote(markerPath)} ] || ([ -f ${shellQuote(
        markerPath
      )} ] && grep -qxF ${shellQuote(expected)} ${shellQuote(markerPath)})`,
      { signal, timeoutMs: 5_000 }
    )
    return result.exitCode === 0
  } catch {
    return false
  }
}

function compactInstallOutput(stderr: string, stdout: string) {
  return [stderr, stdout].flatMap((value) =>
    value.split(/\r?\n/).flatMap((line) => {
      const compact = compactLine(line, 300)
      return compact ? [compact] : []
    })
  )
}

async function emitLog(input: PresetScriptInput, log: CodexRunLog) {
  await input.onLog?.(log)
}

function streamInstallLog(input: PresetScriptInput, kind: "stderr" | "stdout") {
  return (data: string) => {
    const trimmed = compactLine(data)
    if (trimmed) void input.onLog?.({ kind, message: trimmed })
  }
}

export async function runPathInstallScript(
  sandbox: Sandbox,
  input: PresetScriptInput,
  paths: DaytonaSandboxPaths,
  gitAuth?: SandboxGitHubAuth | null
) {
  const script = input.sandboxPreset?.pathInstallScript?.trim()
  if (!script) return

  const scriptHash = sha256(script)
  const scriptPath = `${paths.codexHome}/path-install-${scriptHash}.sh`
  const markerPath = `${paths.codexHome}/path-install-${scriptHash}.fingerprint`
  if (
    await sandboxMarkerMatches(sandbox, markerPath, scriptHash, input.signal)
  ) {
    return
  }

  await emitLog(input, {
    kind: "setup",
    message: `Running ${input.sandboxPreset?.name ?? "preset"} PATH setup script`,
  })
  await emitLog(input, {
    kind: "command",
    message: "preset PATH setup script",
  })

  await writeDaytonaTextFile(
    sandbox,
    scriptPath,
    ["#!/usr/bin/env bash", "set -eo pipefail", script, ""].join("\n")
  )

  const terminalPath = daytonaTerminalPath(paths.home)
  const command = [
    "set -eo pipefail",
    `[ -f ${shellQuote(paths.presetEnvPath)} ] && . ${shellQuote(
      paths.presetEnvPath
    )}`,
    `export HOME=${shellQuote(paths.home)}`,
    `export PATH=${shellQuote(terminalPath)}`,
    `mkdir -p ${shellQuote(`${paths.home}/.local/bin`)} ${shellQuote(
      `${paths.home}/.local/share/pnpm`
    )} ${shellQuote(`${paths.home}/.cache/npm`)} ${shellQuote(
      `${paths.home}/.cache/yarn`
    )} ${shellQuote(`${paths.home}/.cache/bun`)} ${shellQuote(
      `${paths.home}/.pnpm-store`
    )}`,
    `export PNPM_HOME=${shellQuote(`${paths.home}/.local/share/pnpm`)}`,
    `export NPM_CONFIG_PREFIX=${shellQuote(`${paths.home}/.npm-global`)}`,
    `export npm_config_prefix=${shellQuote(`${paths.home}/.npm-global`)}`,
    `export NPM_CONFIG_CACHE=${shellQuote(`${paths.home}/.cache/npm`)}`,
    `export npm_config_cache=${shellQuote(`${paths.home}/.cache/npm`)}`,
    `export YARN_CACHE_FOLDER=${shellQuote(`${paths.home}/.cache/yarn`)}`,
    `export BUN_INSTALL=${shellQuote(`${paths.home}/.bun`)}`,
    `export BUN_INSTALL_CACHE_DIR=${shellQuote(`${paths.home}/.cache/bun`)}`,
    `if [ -s ${shellQuote(markerPath)} ] || ([ -f ${shellQuote(markerPath)} ] && grep -qxF ${shellQuote(
      scriptHash
    )} ${shellQuote(markerPath)}); then`,
    "  exit 0",
    "fi",
    `chmod +x ${shellQuote(scriptPath)}`,
    `${shellQuote(scriptPath)}`,
    linkSandboxPathToolsCommand(paths),
    `printf '%s\\n' ${shellQuote(scriptHash)} > ${shellQuote(markerPath)}`,
  ].join("\n")

  const result = await runDaytonaCommand(sandbox, command, {
    cwd: paths.home,
    env: sandboxInstallEnv(paths, {
      extraEnv: gitAuth?.env,
      secrets: input.sandboxPreset?.secrets,
    }),
    onStderr: streamInstallLog(input, "stderr"),
    onStdout: streamInstallLog(input, "stdout"),
    signal: input.signal,
    timeoutMs: PRESET_INSTALL_TIMEOUT_MS,
  })

  if (result.exitCode !== 0) {
    throw new Error(
      [
        `Preset PATH setup script failed with exit code ${result.exitCode}.`,
        ...compactInstallOutput(result.stderr, result.stdout).slice(-24),
      ].join("\n")
    )
  }

  await emitLog(input, {
    kind: "setup",
    message: "Preset PATH setup script completed",
  })
}

export async function runPresetInstallScript(
  sandbox: Sandbox,
  input: PresetScriptInput,
  paths: DaytonaSandboxPaths,
  gitAuth?: SandboxGitHubAuth | null
) {
  const script = input.sandboxPreset?.installScript?.trim()
  if (!script) return

  const scriptHash = sha256(script)
  const scriptPath = `${paths.codexHome}/preset-install-${scriptHash}.sh`
  const markerPath = `${paths.codexHome}/preset-install-${scriptHash}.fingerprint`
  if (
    await sandboxMarkerMatches(sandbox, markerPath, scriptHash, input.signal)
  ) {
    return
  }

  await emitLog(input, {
    kind: "setup",
    message: `Running ${input.sandboxPreset?.name ?? "preset"} install script`,
  })
  await emitLog(input, {
    kind: "command",
    message: "preset install script",
  })

  await writeDaytonaTextFile(
    sandbox,
    scriptPath,
    ["#!/usr/bin/env bash", "set -eo pipefail", script, ""].join("\n")
  )

  const terminalPath = daytonaTerminalPath(paths.home)
  const command = [
    "set -eo pipefail",
    `[ -f ${shellQuote(paths.presetEnvPath)} ] && . ${shellQuote(
      paths.presetEnvPath
    )}`,
    `mkdir -p ${shellQuote(`${paths.home}/.cache/npm`)} ${shellQuote(
      `${paths.home}/.cache/yarn`
    )} ${shellQuote(`${paths.home}/.cache/bun`)} ${shellQuote(
      `${paths.home}/.local/share/pnpm`
    )} ${shellQuote(`${paths.home}/.pnpm-store`)}`,
    `export PATH=${shellQuote(terminalPath)}`,
    `export PNPM_HOME=${shellQuote(`${paths.home}/.local/share/pnpm`)}`,
    `export NPM_CONFIG_CACHE=${shellQuote(`${paths.home}/.cache/npm`)}`,
    `export npm_config_cache=${shellQuote(`${paths.home}/.cache/npm`)}`,
    `export NPM_CONFIG_STORE_DIR=${shellQuote(`${paths.home}/.pnpm-store`)}`,
    `export npm_config_store_dir=${shellQuote(`${paths.home}/.pnpm-store`)}`,
    'export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"',
    "export PNPM_CONFIG_CHILD_CONCURRENCY=1",
    "export npm_config_child_concurrency=1",
    "export PNPM_CONFIG_WORKSPACE_CONCURRENCY=1",
    "export npm_config_workspace_concurrency=1",
    "export PNPM_CONFIG_NETWORK_CONCURRENCY=16",
    "export npm_config_network_concurrency=16",
    "export PNPM_CONFIG_VERIFY_STORE_INTEGRITY=false",
    "export npm_config_verify_store_integrity=false",
    `export YARN_CACHE_FOLDER=${shellQuote(`${paths.home}/.cache/yarn`)}`,
    `export BUN_INSTALL_CACHE_DIR=${shellQuote(`${paths.home}/.cache/bun`)}`,
    `command -v pnpm >/dev/null 2>&1 && pnpm config set store-dir ${shellQuote(
      `${paths.home}/.pnpm-store`
    )} --location=user >/dev/null 2>&1 || true`,
    `if [ -s ${shellQuote(markerPath)} ] || ([ -f ${shellQuote(markerPath)} ] && grep -qxF ${shellQuote(
      scriptHash
    )} ${shellQuote(markerPath)}); then`,
    "  exit 0",
    "fi",
    `chmod +x ${shellQuote(scriptPath)}`,
    `${shellQuote(scriptPath)}`,
    `printf '%s\\n' ${shellQuote(scriptHash)} > ${shellQuote(markerPath)}`,
  ].join("\n")

  const result = await runDaytonaCommand(sandbox, command, {
    cwd: paths.repoPath,
    env: sandboxInstallEnv(paths, {
      extraEnv: gitAuth?.env,
      secrets: input.sandboxPreset?.secrets,
    }),
    onStderr: streamInstallLog(input, "stderr"),
    onStdout: streamInstallLog(input, "stdout"),
    signal: input.signal,
    timeoutMs: PRESET_INSTALL_TIMEOUT_MS,
  })

  if (result.exitCode !== 0) {
    throw new Error(
      [
        `Preset install script failed with exit code ${result.exitCode}.`,
        ...compactInstallOutput(result.stderr, result.stdout).slice(-24),
      ].join("\n")
    )
  }

  await emitLog(input, {
    kind: "setup",
    message: "Preset install script completed",
  })
}
