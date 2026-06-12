import type { Sandbox } from "@daytona/sdk"

import {
  codexCliPackageName,
  codexCliVersionOutput,
  desiredCodexCliVersion,
} from "@/lib/codex/cli-version"
import { compactLine } from "@/lib/shared/compact-line"
import type { CodexRunLog as RunCodexLog } from "@/lib/codex/run-log"
import {
  daytonaTerminalPath,
  runDaytonaCommand,
  shellQuote,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"

const CODEX_UPDATE_TIMEOUT_MS = 3 * 60 * 1000

type CodexCliSetupInput = {
  onLog?: (log: RunCodexLog) => void | Promise<void>
  signal?: AbortSignal
}

export async function isCodexLauncherReady(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  try {
    const desiredVersion = desiredCodexCliVersion()
    const versionCheck =
      desiredVersion === "latest"
        ? "true"
        : `[ "$(${shellQuote(paths.codexLauncherPath)} --version 2>/dev/null || true)" = ${shellQuote(
            codexCliVersionOutput(desiredVersion)
          )} ]`
    const result = await runDaytonaCommand(
      sandbox,
      `test -x ${shellQuote(paths.codexLauncherPath)} && ${versionCheck}`,
      { signal, timeoutMs: 10_000 }
    )
    return result.exitCode === 0
  } catch {
    return false
  }
}

export async function updateCodexCli(
  sandbox: Sandbox,
  input: CodexCliSetupInput,
  paths: DaytonaSandboxPaths
) {
  await input.onLog?.({
    kind: "setup",
    message: "Preparing Codex CLI",
  })

  const desiredVersion = desiredCodexCliVersion()
  const packageName = codexCliPackageName(desiredVersion)
  const versionReady =
    desiredVersion === "latest"
      ? "command -v codex >/dev/null 2>&1"
      : `current="$(codex --version 2>/dev/null || true)"; [ "$current" = ${shellQuote(
          codexCliVersionOutput(desiredVersion)
        )} ]`

  const updateCommand = [
    "set -e",
    `if command -v codex >/dev/null 2>&1 && ${versionReady}; then`,
    "  true",
    "elif command -v npm >/dev/null 2>&1; then",
    `  npm install -g --force ${shellQuote(packageName)}`,
    "elif command -v bun >/dev/null 2>&1; then",
    `  bun install -g ${shellQuote(packageName)}`,
    "else",
    "  echo 'Install Node.js/npm, Bun, or the Codex CLI in the selected Daytona snapshot.' >&2",
    "  exit 1",
    "fi",
    `cat > ${shellQuote(paths.codexLauncherPath)} <<'EOF'`,
    "#!/usr/bin/env bash",
    "set -e",
    'exec codex "$@"',
    "EOF",
    `chmod +x ${shellQuote(paths.codexLauncherPath)}`,
    `${shellQuote(paths.codexLauncherPath)} --version`,
  ].join("\n")

  await input.onLog?.({
    detail:
      desiredVersion === "latest"
        ? "runs once when this app thread initializes its Daytona sandbox"
        : `requires codex-cli ${desiredVersion}`,
    kind: "command",
    message:
      desiredVersion === "latest"
        ? "use preinstalled codex or install @openai/codex when needed"
        : `use preinstalled codex or install ${packageName} when needed`,
  })

  const result = await runDaytonaCommand(sandbox, updateCommand, {
    cwd: paths.home,
    env: {
      HOME: paths.home,
      MISE_TRUSTED_CONFIG_PATHS: paths.repoPath,
      PATH: daytonaTerminalPath(paths.home),
    },
    onStderr: (data) => {
      const trimmed = compactLine(data)
      if (trimmed) void input.onLog?.({ kind: "stderr", message: trimmed })
    },
    onStdout: (data) => {
      const trimmed = compactLine(data)
      if (trimmed) void input.onLog?.({ kind: "stdout", message: trimmed })
    },
    signal: input.signal,
    timeoutMs: CODEX_UPDATE_TIMEOUT_MS,
  })

  if (result.exitCode !== 0) {
    throw new Error(
      [
        "Unable to prepare Codex CLI in the Daytona sandbox.",
        ...[result.stderr, result.stdout].flatMap((value) =>
          value
            .split(/\r?\n/)
            .flatMap((line) => {
              const compact = compactLine(line, 300)
              return compact ? [compact] : []
            })
            .slice(-8)
        ),
      ].join("\n")
    )
  }

  const version =
    result.stdout
      .split(/\r?\n/)
      .flatMap((line) => {
        const trimmed = line.trim()
        return trimmed ? [trimmed] : []
      })
      .at(-1) || "Codex CLI ready"

  await input.onLog?.({
    kind: "setup",
    message: version,
  })
}
