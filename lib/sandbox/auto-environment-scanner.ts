import type { Sandbox } from "@daytona/sdk"

import { compactAnsiLine } from "@/lib/shared/compact-line"
import {
  codexCliPackageName,
  codexCliVersionOutput,
  desiredCodexCliVersion,
} from "@/lib/codex/cli-version"
import { codexShellEnv } from "@/lib/daytona/codex-runtime"
import {
  daytonaTerminalPath,
  installDaytonaTarWrapper,
  miseTrustedConfigPaths,
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"
import type { SandboxGitHubAuth } from "@/lib/sandbox/github-auth"

const AUTO_BUILD_SCAN_TIMEOUT_MS = 12 * 60 * 1000

const silentCommandOutput = {
  onStderr: () => undefined,
  onStdout: () => undefined,
}

function helpIncludes(help: string, flag: string) {
  return help.includes(flag)
}

export async function prepareBuilderCodex(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  authJson: string,
  signal?: AbortSignal
) {
  await runDaytonaCommand(
    sandbox,
    [
      `mkdir -p ${shellQuote(paths.runtimeHome)} ${shellQuote(paths.codexHome)}`,
      `chmod 700 ${shellQuote(paths.runtimeHome)} ${shellQuote(paths.codexHome)}`,
    ].join(" && "),
    { signal, timeoutMs: 10_000 }
  )
  await installDaytonaTarWrapper(sandbox, paths)

  const desiredVersion = desiredCodexCliVersion()
  const packageName = codexCliPackageName(desiredVersion)
  const versionReady =
    desiredVersion === "latest"
      ? "command -v codex >/dev/null 2>&1"
      : `current="$(codex --version 2>/dev/null || true)"; [ "$current" = ${shellQuote(
          codexCliVersionOutput(desiredVersion)
        )} ]`
  const installCommand = [
    "set -e",
    `if command -v codex >/dev/null 2>&1 && ${versionReady}; then`,
    "  true",
    "elif command -v npm >/dev/null 2>&1; then",
    `  npm install -g --force ${shellQuote(packageName)}`,
    "elif command -v bun >/dev/null 2>&1; then",
    `  bun install -g ${shellQuote(packageName)}`,
    "else",
    "  echo 'Install Node.js/npm, Bun, or the Codex CLI in the base snapshot.' >&2",
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

  const result = await runDaytonaCommand(sandbox, installCommand, {
    cwd: paths.home,
    env: {
      HOME: paths.home,
      MISE_TRUSTED_CONFIG_PATHS: miseTrustedConfigPaths(paths),
      PATH: daytonaTerminalPath(paths.home),
      TAR_OPTIONS: "--no-same-owner --no-same-permissions",
    },
    ...silentCommandOutput,
    signal,
    timeoutMs: 3 * 60 * 1000,
  })

  if (result.exitCode !== 0) {
    throw new Error(
      compactAnsiLine(result.stderr || result.stdout, 260) ||
        "Unable to prepare Codex CLI for environment scanning."
    )
  }

  await writeDaytonaTextFile(sandbox, `${paths.codexHome}/auth.json`, authJson)
  await runDaytonaCommand(
    sandbox,
    `chmod 600 ${shellQuote(`${paths.codexHome}/auth.json`)}`,
    { signal, timeoutMs: 10_000 }
  )
}

function scannerPrompt(repoPath: string) {
  return [
    "You are Cloudcode's automatic environment scanner.",
    "",
    `The repository is already cloned at ${repoPath}. Your current working directory is outside the repository. Keep Codex running outside the repo; use explicit cd commands or absolute paths when you inspect files.`,
    "",
    "Goal: create a valid repo-root cloudcode.yaml that tells Cloudcode exactly what to download/install globally, what to install in the repo, and optional environment checks.",
    "",
    "You may run shell commands to inspect the project. You may download/install tools under the sandbox home and repo dependencies if that is necessary to verify the recipe, but every required step must also be encoded in cloudcode.yaml.",
    "",
    "Inspect README files, AGENTS.md, package manifests, lockfiles, pyproject.toml, requirements files, go.mod, Cargo.toml, Dockerfiles, devcontainer config, CI workflows, version files, and scripts.",
    "",
    'If the repo has a tool manager config such as .mise.toml, .tool-versions, packageManager, volta, or engines, do not invent separate tool versions. Use the repo\'s config. For mise repos, prefer a global command like: cd "$CLOUDCODE_REPO" && mise trust -y .mise.toml && mise install. Do not generate explicit versioned tool install commands unless the repo has no config file and you must install those tools directly.',
    "",
    "If .devcontainer/devcontainer.json defines postCreateCommand, use the relevant command from it for repo setup unless it is clearly unrelated. Preserve important flags from that command.",
    "",
    "Global commands run outside the repo with CLOUDCODE_REPO pointing at the repository path. Repo commands run inside the repo. Use CLOUDCODE_REPO only when a global tool install needs to read repo config.",
    "",
    "Do not prefix every repo or check command with mise exec -- when the command runs from the repo. Cloudcode puts mise shims first in PATH and runs repo commands from the repo, so bare commands such as bun install --frozen-lockfile and bun run test are preferred after the global mise install step. Use mise exec -- only when a command must run outside the repo or shims are insufficient.",
    "",
    "Do not force compiler variables such as CC=clang or CXX=clang++ unless repository docs require them or you verified those compilers are installed. Prefer the repo's normal install command.",
    "",
    "Write only this file in the repo unless a generated lockfile is required by the install command: cloudcode.yaml.",
    "",
    "Required YAML shape. Use global as a list of global install commands. Nested global.install and top-level initialize are accepted for compatibility, but do not generate them.",
    "global:",
    "  - name: Install pnpm",
    "    run: npm install -g pnpm",
    "  - name: Install uv",
    "    run: curl -LsSf https://astral.sh/uv/install.sh | sh",
    "repo:",
    "  - name: Install dependencies",
    "    run: pnpm install --frozen-lockfile",
    "",
    "Important: for every required language runtime, package manager, SDK, database client, browser, or CLI, include a concrete download/install command in the global list unless you have just verified it already exists in the base snapshot. Do not use metadata-only fields in newly generated YAML.",
    "",
    "Use commands that are realistic for this repo. Prefer frozen lockfile installs when a lockfile exists. Do not include secret values. Do not use package-manager-specific OS dependency flags such as Playwright --with-deps unless you verified that the base snapshot supports the needed package manager; prefer installing only the browser runtime in repo setup and leave OS package repair as an explicit command only when verified. Do not include lint, format, typecheck, test, browser-test, smoke-test, or build commands unless they are directly needed to validate the environment. If a command is unsafe, destructive, overly expensive, or requires credentials not present, omit it.",
    "",
    "Cloudcode setup sandboxes have 4 GB of RAM by default. Keep that limit in mind when choosing install commands, but do not add low-memory flags by default. Add package-manager concurrency limits only when the repo's install is likely to be memory-heavy, such as Bun projects with native dependencies, large monorepos, many lifecycle scripts, or docs/CI/devcontainer evidence of memory pressure. For Bun dependency installs, prefer bun install --frozen-lockfile normally, and use flags such as --concurrent-scripts 1 only when those memory-heavy conditions apply.",
    "",
    "When finished, make sure cloudcode.yaml parses as YAML and contains concrete run commands.",
  ].join("\n")
}

export async function runScannerCodex(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  gitAuth?: SandboxGitHubAuth | null,
  signal?: AbortSignal
) {
  const promptPath = `${paths.codexHome}/auto-environment-prompt.txt`
  const lastMessagePath = `${paths.codexHome}/auto-environment-last-message.txt`
  await writeDaytonaTextFile(sandbox, promptPath, scannerPrompt(paths.repoPath))

  const help = (
    await runDaytonaCommand(
      sandbox,
      `${shellQuote(paths.codexLauncherPath)} exec --help`,
      {
        cwd: paths.home,
        env: codexShellEnv(paths, {
          extraEnv: gitAuth?.env,
          includeTarOptions: false,
        }),
        signal,
        timeoutMs: 10_000,
      }
    )
  ).stdout
  const optionalFlags = [
    helpIncludes(help, "--dangerously-bypass-approvals-and-sandbox")
      ? "--dangerously-bypass-approvals-and-sandbox"
      : "",
    !helpIncludes(help, "--dangerously-bypass-approvals-and-sandbox") &&
    helpIncludes(help, "--sandbox")
      ? "--sandbox danger-full-access"
      : "",
    helpIncludes(help, "--skip-git-repo-check") ? "--skip-git-repo-check" : "",
    helpIncludes(help, "--ignore-user-config") ? "--ignore-user-config" : "",
    helpIncludes(help, "--output-last-message")
      ? `--output-last-message ${shellQuote(lastMessagePath)}`
      : "",
    helpIncludes(help, "--cd") || helpIncludes(help, "-C,")
      ? `-C ${shellQuote(paths.home)}`
      : "",
  ]
    .filter(Boolean)
    .join(" ")

  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `cd ${shellQuote(paths.home)}`,
      `HOME=${shellQuote(paths.runtimeHome)} CODEX_HOME=${shellQuote(
        paths.codexHome
      )} BASH_ENV=/dev/null SHELL=/bin/bash ${shellQuote(
        paths.codexLauncherPath
      )} exec ${optionalFlags} < ${shellQuote(promptPath)}`,
    ].join("\n"),
    {
      cwd: paths.home,
      env: codexShellEnv(paths, {
        extraEnv: gitAuth?.env,
        includeTarOptions: false,
      }),
      ...silentCommandOutput,
      signal,
      timeoutMs: AUTO_BUILD_SCAN_TIMEOUT_MS,
    }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      [
        `Environment scanner exited with code ${result.exitCode}.`,
        compactAnsiLine(result.stderr || result.stdout, 260),
      ]
        .filter(Boolean)
        .join("\n")
    )
  }
}
