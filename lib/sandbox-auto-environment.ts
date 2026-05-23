import { ConvexHttpClient } from "convex/browser"
import type { Sandbox } from "@daytona/sdk"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getConvexAuthToken } from "@/lib/codex-auth"
import {
  cloudcodeYamlHash,
  formatCloudcodeYaml,
  normalizeCloudcodeYaml,
  parseCloudcodeYaml,
  type CloudcodeCommand,
  type CloudcodeYamlConfig,
} from "@/lib/cloudcode-yaml"
import {
  createDaytonaSandbox,
  daytonaCodexPath,
  daytonaTerminalPath,
  defaultDaytonaSnapshot,
  deleteDaytonaSandboxQuietly,
  getStartedDaytonaSandbox,
  installDaytonaTarWrapper,
  readDaytonaTextFile,
  resolveDaytonaPaths,
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona-sandbox"
import type { RunCodexLog, SandboxPresetInput } from "@/lib/daytona-codex-agent"
import type { SandboxPresetForRun } from "@/lib/sandbox-presets"

const AUTO_BUILD_SCAN_TIMEOUT_MS = 12 * 60 * 1000
const BUILD_LOG_BATCH_SIZE = 20
const BUILD_LOG_FLUSH_DELAY_MS = 500
const BUILD_LOG_FINAL_FLUSH_TIMEOUT_MS = 2_000
const CXX20_REPAIR_COMMAND_NAME = "Install C++20 compiler"
const MISE_TRUST_COMMAND_NAME = "Trust mise config"
const MISE_CONFIG_FILES = [
  ".mise.toml",
  "mise.toml",
  ".config/mise.toml",
  ".config/mise/config.toml",
]
const CXX20_REPAIR_COMMAND = [
  "set -e",
  'check_cxx20() { command -v "$1" >/dev/null 2>&1 && printf "int main(){return 0;}\\n" | "$1" -std=gnu++20 -x c++ - -o /tmp/cloudcode-cxx20-check >/dev/null 2>&1; }',
  "for cxx in g++ c++ clang++; do",
  '  if check_cxx20 "$cxx"; then',
  '    echo "C++20 compiler already available: $cxx"',
  "    exit 0",
  "  fi",
  "done",
  'prefix=""',
  'if [ "$(id -u)" != "0" ]; then prefix="sudo"; fi',
  "run_root() {",
  '  if [ -n "$prefix" ]; then sudo env "$@"; else env "$@"; fi',
  "}",
  "if command -v apt-get >/dev/null 2>&1; then",
  "  run_root DEBIAN_FRONTEND=noninteractive apt-get update -qq",
  '  for packages in "g++-14 make python3" "g++-13 make python3" "g++-12 make python3" "g++-11 make python3" "g++-10 make python3" "clang make python3" "g++ make python3"; do',
  "    if run_root DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $packages; then break; fi",
  "  done",
  "elif command -v apk >/dev/null 2>&1; then",
  '  if [ -n "$prefix" ]; then sudo apk add --no-cache build-base clang python3; else apk add --no-cache build-base clang python3; fi',
  "elif command -v dnf >/dev/null 2>&1; then",
  '  if [ -n "$prefix" ]; then sudo dnf install -y gcc-c++ clang make python3; else dnf install -y gcc-c++ clang make python3; fi',
  "elif command -v yum >/dev/null 2>&1; then",
  '  if [ -n "$prefix" ]; then sudo yum install -y gcc-c++ clang make python3; else yum install -y gcc-c++ clang make python3; fi',
  "elif command -v zypper >/dev/null 2>&1; then",
  '  if [ -n "$prefix" ]; then sudo zypper --non-interactive install gcc-c++ clang make python3; else zypper --non-interactive install gcc-c++ clang make python3; fi',
  "else",
  '  echo "No supported package manager found to install a C++20 compiler." >&2',
  "fi",
  'mkdir -p "$HOME/.local/bin"',
  "for cxx in g++-14 g++-13 g++-12 g++-11 g++-10 g++ c++ clang++; do",
  '  if check_cxx20 "$cxx"; then',
  '    target="$(command -v "$cxx")"',
  '    ln -sf "$target" "$HOME/.local/bin/g++"',
  '    ln -sf "$target" "$HOME/.local/bin/c++"',
  '    echo "Using $target for C++20 builds"',
  "    exit 0",
  "  fi",
  "done",
  'echo "No C++20-capable compiler was found after repair." >&2',
  "exit 1",
].join("\n")

type AutoEnvironmentBuildRecord = {
  buildId: Id<"sandboxPresetBuilds">
  buildNumber: number
  environmentId: Id<"sandboxPresetEnvironments">
  environmentSlug: string
}

type StoredBuildLog = RunCodexLog & { time: number }

class CloudcodeCommandError extends Error {
  command: CloudcodeCommand
  commandIndex: number
  exitCode: number
  label: string
  output: string

  constructor({
    command,
    commandIndex,
    exitCode,
    label,
    output,
  }: {
    command: CloudcodeCommand
    commandIndex: number
    exitCode: number
    label: string
    output: string
  }) {
    const name = command.name ?? `${label} ${commandIndex + 1}`
    super(
      [`${name} failed with exit code ${exitCode}.`, output]
        .filter(Boolean)
        .join("\n")
    )
    this.name = "CloudcodeCommandError"
    this.command = command
    this.commandIndex = commandIndex
    this.exitCode = exitCode
    this.label = label
    this.output = output
  }
}

export type AutoEnvironmentResult = {
  cloudcodeYaml?: string
  preparedSandboxFresh?: boolean
  preset: SandboxPresetInput
  requireExistingSandbox?: boolean
  sandboxId?: string
  updatedAuthJson?: string
}

export type EnsureAutoEnvironmentInput = {
  authJson: string
  baseBranch?: string
  currentSandboxId?: string
  githubToken?: string
  onLog?: (log: RunCodexLog) => void | Promise<void>
  repoUrl: string
  sandboxPreset: SandboxPresetForRun
  signal?: AbortSignal
  workerSecret?: string
}

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL

  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before using Convex storage.")
  }

  return url
}

async function getConvexClient(workerSecret?: string) {
  const client = new ConvexHttpClient(getConvexUrl())
  if (!workerSecret) {
    client.setAuth(await getConvexAuthToken())
  }
  return client
}

async function getAutoEnvironmentForRun(
  client: ConvexHttpClient,
  input: EnsureAutoEnvironmentInput
) {
  if (input.workerSecret) {
    return (await client.query(
      api.sandboxPresets.getAutoEnvironmentForRunForWorker,
      {
        presetId: input.sandboxPreset.id,
        repoUrl: input.repoUrl,
        workerSecret: input.workerSecret,
      }
    )) as {
      activeSandboxId?: string
      cloudcodeYaml?: string
      status: string
    } | null
  }

  return (await client.query(api.sandboxPresets.getAutoEnvironmentForRun, {
    presetId: input.sandboxPreset.id,
    repoUrl: input.repoUrl,
  })) as {
    activeSandboxId?: string
    cloudcodeYaml?: string
    status: string
  } | null
}

async function beginAutoEnvironmentBuild(
  client: ConvexHttpClient,
  input: EnsureAutoEnvironmentInput
) {
  if (input.workerSecret) {
    return (await client.mutation(
      api.sandboxPresets.beginAutoEnvironmentBuildForWorker,
      {
        baseBranch: input.baseBranch,
        presetId: input.sandboxPreset.id,
        repoUrl: input.repoUrl,
        workerSecret: input.workerSecret,
      }
    )) as AutoEnvironmentBuildRecord
  }

  return (await client.mutation(api.sandboxPresets.beginAutoEnvironmentBuild, {
    baseBranch: input.baseBranch,
    presetId: input.sandboxPreset.id,
    repoUrl: input.repoUrl,
  })) as AutoEnvironmentBuildRecord
}

async function appendAutoEnvironmentBuildLogs(
  client: ConvexHttpClient,
  buildId: Id<"sandboxPresetBuilds">,
  logs: StoredBuildLog[],
  workerSecret?: string
) {
  if (workerSecret) {
    return await client.mutation(
      api.sandboxPresets.appendAutoEnvironmentBuildLogsForWorker,
      {
        buildId,
        logs,
        workerSecret,
      }
    )
  }

  return await client.mutation(
    api.sandboxPresets.appendAutoEnvironmentBuildLogs,
    {
      buildId,
      logs,
    }
  )
}

async function completeAutoEnvironmentBuild(
  client: ConvexHttpClient,
  args: {
    buildId: Id<"sandboxPresetBuilds">
    cloudcodeYaml: string
    configHash: string
    sandboxId?: string
  },
  workerSecret?: string
) {
  if (workerSecret) {
    return await client.mutation(
      api.sandboxPresets.completeAutoEnvironmentBuildForWorker,
      {
        ...args,
        workerSecret,
      }
    )
  }

  return await client.mutation(
    api.sandboxPresets.completeAutoEnvironmentBuild,
    args
  )
}

async function failAutoEnvironmentBuild(
  client: ConvexHttpClient,
  args: {
    buildId: Id<"sandboxPresetBuilds">
    error: string
  },
  workerSecret?: string
) {
  if (workerSecret) {
    return await client.mutation(
      api.sandboxPresets.failAutoEnvironmentBuildForWorker,
      {
        ...args,
        workerSecret,
      }
    )
  }

  return await client.mutation(
    api.sandboxPresets.failAutoEnvironmentBuild,
    args
  )
}

const ANSI_ESCAPE_PATTERN = new RegExp(
  String.raw`\u001B\[[0-?]*[ -/]*[@-~]`,
  "g"
)

function compactLine(value: string, max = 260) {
  const line = value
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim()
  return line.length > max ? `${line.slice(0, max - 3)}...` : line
}

function compactTail(value: string, max = 900) {
  const line = value
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim()
  return line.length > max ? `...${line.slice(-(max - 3))}` : line
}

function presetSecretEnv(preset: SandboxPresetForRun) {
  return Object.fromEntries(
    preset.secrets.map((secret) => [secret.name, secret.value])
  )
}

function codexShellEnv(paths: DaytonaSandboxPaths) {
  return {
    BASH_ENV: "/dev/null",
    CODEX_HOME: paths.codexHome,
    HOME: paths.runtimeHome,
    MISE_TRUSTED_CONFIG_PATHS: paths.repoPath,
    PATH: daytonaCodexPath(paths),
    SHELL: "/bin/bash",
  }
}

function helpIncludes(help: string, flag: string) {
  return help.includes(flag)
}

function createBuildLogEmitter(
  client: ConvexHttpClient,
  buildId: Id<"sandboxPresetBuilds">,
  input: EnsureAutoEnvironmentInput
) {
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let flushPromise: Promise<void> | undefined
  const pending: StoredBuildLog[] = []

  const clearFlushTimer = () => {
    if (!flushTimer) return
    clearTimeout(flushTimer)
    flushTimer = undefined
  }

  const flush = () => {
    if (flushPromise) return flushPromise
    clearFlushTimer()
    const logs = pending.splice(0, BUILD_LOG_BATCH_SIZE)
    if (logs.length === 0) return Promise.resolve()

    flushPromise = appendAutoEnvironmentBuildLogs(
      client,
      buildId,
      logs,
      input.workerSecret
    )
      .catch(() => undefined)
      .then(() => undefined)
      .finally(() => {
        flushPromise = undefined
        if (pending.length > 0) void flush()
      })

    return flushPromise
  }

  const scheduleFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      void flush()
    }, BUILD_LOG_FLUSH_DELAY_MS)
  }

  const waitForFinalFlush = async () => {
    clearFlushTimer()
    const deadline = Date.now() + BUILD_LOG_FINAL_FLUSH_TIMEOUT_MS

    const flushUntilDone = async (): Promise<void> => {
      if ((pending.length === 0 && !flushPromise) || Date.now() >= deadline) {
        return
      }
      if (pending.length > 0) void flush()
      await (flushPromise ?? Promise.resolve())
      return flushUntilDone()
    }

    await flushUntilDone()
  }

  return {
    emit(log: RunCodexLog) {
      try {
        void input.onLog?.(log)
      } catch {
        // The live response may already be closed; persisted logs are best effort.
      }

      pending.push({ ...log, time: Date.now() })
      if (pending.length >= BUILD_LOG_BATCH_SIZE) void flush()
      else scheduleFlush()

      return Promise.resolve()
    },
    flush: waitForFinalFlush,
  }
}

const silentCommandOutput = {
  onStderr: () => undefined,
  onStdout: () => undefined,
}

async function prepareBuilderCodex(
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

  const installCommand = [
    "set -e",
    "if command -v codex >/dev/null 2>&1; then",
    "  true",
    "elif command -v npm >/dev/null 2>&1; then",
    "  npm install -g @openai/codex@latest",
    "elif command -v bun >/dev/null 2>&1; then",
    "  bun install -g @openai/codex@latest",
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
      MISE_TRUSTED_CONFIG_PATHS: paths.repoPath,
      PATH: daytonaTerminalPath(paths.home),
      TAR_OPTIONS: "--no-same-owner --no-same-permissions",
    },
    ...silentCommandOutput,
    signal,
    timeoutMs: 3 * 60 * 1000,
  })

  if (result.exitCode !== 0) {
    throw new Error(
      compactLine(result.stderr || result.stdout) ||
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
    "Goal: create a valid repo-root cloudcode.yaml that tells Cloudcode exactly what to download/install globally, what to install in the repo, optional environment checks, and how to start the dev server.",
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
    "Do not prefix every repo, check, or dev command with mise exec -- when the command runs from the repo. Cloudcode puts mise shims first in PATH and runs repo commands from the repo, so bare commands such as bun install --frozen-lockfile and bun run test are preferred after the global mise install step. Use mise exec -- only when a command must run outside the repo or shims are insufficient.",
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
    "dev:",
    "  command: pnpm dev",
    "  port: 3000",
    "",
    "Important: for every required language runtime, package manager, SDK, database client, browser, or CLI, include a concrete download/install command in the global list unless you have just verified it already exists in the base snapshot. Do not use metadata-only fields in newly generated YAML.",
    "",
    "Use commands that are realistic for this repo. Prefer frozen lockfile installs when a lockfile exists. Do not include secret values. Do not use package-manager-specific OS dependency flags such as Playwright --with-deps unless you verified that the base snapshot supports the needed package manager; prefer installing only the browser runtime in repo setup and leave OS package repair as an explicit command only when verified. Do not include lint, format, typecheck, test, browser-test, smoke-test, or build commands unless they are directly needed to validate the environment. If a command is unsafe, destructive, overly expensive, or requires credentials not present, omit it.",
    "",
    "When finished, make sure cloudcode.yaml parses as YAML and contains concrete run commands.",
  ].join("\n")
}

async function runScannerCodex(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
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
        env: codexShellEnv(paths),
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
      env: codexShellEnv(paths),
      ...silentCommandOutput,
      signal,
      timeoutMs: AUTO_BUILD_SCAN_TIMEOUT_MS,
    }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      [
        `Environment scanner exited with code ${result.exitCode}.`,
        compactLine(result.stderr || result.stdout),
      ]
        .filter(Boolean)
        .join("\n")
    )
  }
}

async function cloneRepoForBuild({
  baseBranch,
  githubToken,
  repoUrl,
  sandbox,
  signal,
  paths,
}: {
  baseBranch?: string
  githubToken?: string
  repoUrl: string
  sandbox: Sandbox
  signal?: AbortSignal
  paths: DaytonaSandboxPaths
}) {
  await runDaytonaCommand(
    sandbox,
    `rm -rf ${shellQuote(paths.repoPath)} && mkdir -p ${shellQuote(
      paths.repoPath.replace(/\/[^/]+$/, "")
    )}`,
    { signal, timeoutMs: 60_000 }
  )
  await sandbox.git.clone(
    repoUrl,
    paths.repoPath,
    baseBranch,
    undefined,
    githubToken ? "x-access-token" : undefined,
    githubToken
  )
}

function commandTimeout(command: CloudcodeCommand) {
  return (command.timeoutMinutes ?? 20) * 60 * 1000
}

function minutesSince(startedAt: number) {
  return Math.max(1, Math.floor((Date.now() - startedAt) / 60_000))
}

async function runCloudcodeCommandList({
  commands,
  cwd,
  emit,
  env,
  label,
  sandbox,
  signal,
  startIndex = 0,
}: {
  commands: CloudcodeCommand[]
  cwd: string
  emit: (log: RunCodexLog) => Promise<void>
  env: Record<string, string>
  label: string
  sandbox: Sandbox
  signal?: AbortSignal
  startIndex?: number
}) {
  if (commands.length === 0) return

  for (const [index, command] of commands.entries()) {
    if (index < startIndex) continue
    const name = command.name ?? `${label} ${index + 1}`
    await emit({
      detail: compactLine(command.run, 500),
      kind: "command",
      message: `Downloading ${name}`,
    })

    const startedAt = Date.now()
    const heartbeat = setInterval(() => {
      void emit({
        kind: "setup",
        message: `Still downloading ${name} after ${minutesSince(startedAt)} minute${minutesSince(startedAt) === 1 ? "" : "s"}`,
      })
    }, 30_000)

    let result
    try {
      result = await runDaytonaCommand(
        sandbox,
        ["set -eo pipefail", command.run].join("\n"),
        {
          cwd,
          env,
          ...silentCommandOutput,
          signal,
          timeoutMs: commandTimeout(command),
        }
      )
    } finally {
      clearInterval(heartbeat)
    }

    if (result.exitCode !== 0) {
      const output = compactTail(result.stderr || result.stdout)
      await emit({
        kind: "result",
        message: `${name} failed with exit code ${result.exitCode}`,
        detail: output || undefined,
      })
      throw new CloudcodeCommandError({
        command,
        commandIndex: index,
        exitCode: result.exitCode,
        label,
        output,
      })
    }
  }
}

function needsCxx20CompilerRepair(error: unknown) {
  if (!(error instanceof CloudcodeCommandError)) return false
  const missingRequestedCompiler =
    /(?:clang\+\+|clang|g\+\+|c\+\+)/.test(error.output) &&
    /not found|No such file or directory|ENOENT|command not found/.test(
      error.output
    ) &&
    /node-gyp|node-pty|binding\.gyp|make/.test(error.output)

  return (
    missingRequestedCompiler ||
    (/-std=gnu\+\+20|-std=c\+\+20/.test(error.output) &&
      /unrecognized command line option|unknown argument|unsupported option/.test(
        error.output
      ))
  )
}

function hasCxx20RepairCommand(config: CloudcodeYamlConfig) {
  return config.global.install.some(
    (command) =>
      command.name === CXX20_REPAIR_COMMAND_NAME ||
      command.run.includes("cloudcode-cxx20-check")
  )
}

function addCxx20RepairCommand(config: CloudcodeYamlConfig) {
  if (hasCxx20RepairCommand(config)) return
  config.global.install.push({
    name: CXX20_REPAIR_COMMAND_NAME,
    run: CXX20_REPAIR_COMMAND,
    timeoutMinutes: 20,
  })
}

function miseTrustCommand(configFiles: string[]) {
  return [
    "set -e",
    'export MISE_TRUSTED_CONFIG_PATHS="$CLOUDCODE_REPO${MISE_TRUSTED_CONFIG_PATHS:+:$MISE_TRUSTED_CONFIG_PATHS}"',
    "if ! command -v mise >/dev/null 2>&1; then",
    "  curl -fsSL https://mise.run | sh",
    '  export PATH="$HOME/.local/bin:$HOME/.mise/bin:$PATH"',
    "fi",
    'cd "$CLOUDCODE_REPO"',
    ...configFiles.map(
      (file) =>
        `[ ! -f ${shellQuote(file)} ] || mise trust -y ${shellQuote(file)}`
    ),
  ].join("\n")
}

function hasMiseTrustCommand(config: CloudcodeYamlConfig) {
  return config.global.install.some(
    (command) =>
      command.name === MISE_TRUST_COMMAND_NAME ||
      /\bmise\s+trust\b/.test(command.run)
  )
}

function addMiseTrustCommand(
  config: CloudcodeYamlConfig,
  configFiles: string[]
) {
  if (configFiles.length === 0 || hasMiseTrustCommand(config)) return
  config.global.install.unshift({
    name: MISE_TRUST_COMMAND_NAME,
    run: miseTrustCommand(configFiles),
    timeoutMinutes: 2,
  })
}

async function listMiseConfigFiles(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set +e",
      `cd ${shellQuote(paths.repoPath)}`,
      ...MISE_CONFIG_FILES.map(
        (file) =>
          `[ -f ${shellQuote(file)} ] && printf '%s\\n' ${shellQuote(file)}`
      ),
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  )

  if (result.exitCode !== 0) return []
  return result.stdout
    .split("\n")
    .map((file) => file.trim())
    .filter((file) => MISE_CONFIG_FILES.includes(file))
}

async function trustMiseConfigFiles({
  configFiles,
  env,
  paths,
  sandbox,
  signal,
}: {
  configFiles: string[]
  env: Record<string, string>
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
  signal?: AbortSignal
}) {
  if (configFiles.length === 0) return

  const result = await runDaytonaCommand(
    sandbox,
    miseTrustCommand(configFiles),
    {
      cwd: paths.home,
      env,
      ...silentCommandOutput,
      signal,
      timeoutMs: 2 * 60 * 1000,
    }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      compactTail(result.stderr || result.stdout) ||
        "Unable to trust repo mise config."
    )
  }
}

async function writeNormalizedCloudcodeYaml({
  config,
  paths,
  sandbox,
}: {
  config: CloudcodeYamlConfig
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
}) {
  const cloudcodeYaml = formatCloudcodeYaml(config)
  await writeDaytonaTextFile(
    sandbox,
    `${paths.repoPath}/cloudcode.yaml`,
    cloudcodeYaml
  )
  return cloudcodeYaml
}

async function repairCxx20Compiler({
  config,
  emit,
  env,
  paths,
  sandbox,
  signal,
}: {
  config: CloudcodeYamlConfig
  emit: (log: RunCodexLog) => Promise<void>
  env: Record<string, string>
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
  signal?: AbortSignal
}) {
  addCxx20RepairCommand(config)
  await writeNormalizedCloudcodeYaml({ config, paths, sandbox })
  await runCloudcodeCommandList({
    commands: [
      {
        name: CXX20_REPAIR_COMMAND_NAME,
        run: CXX20_REPAIR_COMMAND,
        timeoutMinutes: 20,
      },
    ],
    cwd: paths.home,
    emit,
    env,
    label: "Running global environment repair",
    sandbox,
    signal,
  })
}

async function readBuildHashInputs(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set +e",
      `cd ${shellQuote(paths.repoPath)}`,
      "for file in cloudcode.yaml package.json pnpm-lock.yaml package-lock.json yarn.lock bun.lock bun.lockb pyproject.toml uv.lock poetry.lock requirements.txt requirements-dev.txt go.mod go.sum Cargo.toml Cargo.lock Gemfile Gemfile.lock .mise.toml mise.toml .config/mise.toml .config/mise/config.toml .nvmrc .node-version .python-version .tool-versions Dockerfile .devcontainer/devcontainer.json; do",
      '  [ -f "$file" ] && sha256sum "$file"',
      "done",
    ].join("\n"),
    { signal, timeoutMs: 20_000 }
  )
  return result.stdout
}

async function readRepoCloudcodeYaml(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths
) {
  const source = await readDaytonaTextFile(
    sandbox,
    `${paths.repoPath}/cloudcode.yaml`
  ).catch(() => "")

  return source.trim() ? source : undefined
}

async function writeEnvironmentGitExcludes(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `cd ${shellQuote(paths.repoPath)}`,
      "mkdir -p .git/info",
      "cat >> .git/info/exclude <<'EOF'",
      "",
      "# cloudcode auto environment cache",
      "node_modules/",
      ".venv/",
      "venv/",
      ".tox/",
      ".pytest_cache/",
      ".mypy_cache/",
      ".ruff_cache/",
      ".next/",
      "dist/",
      "build/",
      "target/",
      "vendor/bundle/",
      ".bundle/",
      ".pnpm-store/",
      ".turbo/",
      "EOF",
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  ).catch(() => undefined)
}

async function cleanupBuilderFiles(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  await runDaytonaCommand(
    sandbox,
    `rm -f ${shellQuote(`${paths.codexHome}/auth.json`)} ${shellQuote(
      `${paths.codexHome}/auto-environment-prompt.txt`
    )} ${shellQuote(`${paths.codexHome}/auto-environment-last-message.txt`)}`,
    { signal, timeoutMs: 10_000 }
  ).catch(() => undefined)
}

async function buildAutoEnvironmentSandbox({
  build,
  client,
  input,
}: {
  build: AutoEnvironmentBuildRecord
  client: ConvexHttpClient
  input: EnsureAutoEnvironmentInput
}) {
  let sandbox: Sandbox | undefined
  let keepSandbox = false
  const buildLogs = createBuildLogEmitter(client, build.buildId, input)
  const emit = buildLogs.emit

  try {
    void emit({
      kind: "setup",
      message: "Creating Daytona sandbox",
    })
    sandbox = await createDaytonaSandbox({
      name: input.sandboxPreset.name,
      snapshot: input.sandboxPreset.daytonaSnapshot || defaultDaytonaSnapshot(),
    })
    const paths = await resolveDaytonaPaths(sandbox)
    const terminalEnv = {
      CI: "1",
      CLOUDCODE_REPO: paths.repoPath,
      HOME: paths.home,
      MISE_TRUSTED_CONFIG_PATHS: paths.repoPath,
      MISE_YES: "1",
      PATH: daytonaTerminalPath(paths.home),
      TAR_OPTIONS: "--no-same-owner --no-same-permissions",
      ...presetSecretEnv(input.sandboxPreset),
    }

    void emit({
      detail: sandbox.id,
      kind: "setup",
      message: "Auto environment sandbox ready",
    })
    void emit({
      kind: "setup",
      message: "Cloning repository",
    })
    await cloneRepoForBuild({
      baseBranch: input.baseBranch,
      githubToken: input.githubToken,
      repoUrl: input.repoUrl,
      sandbox,
      signal: input.signal,
      paths,
    })
    void emit({
      kind: "setup",
      message: "Repository cloned",
    })
    const miseConfigFiles = await listMiseConfigFiles(
      sandbox,
      paths,
      input.signal
    )
    const rawYamlPromise = readRepoCloudcodeYaml(sandbox, paths)
    await trustMiseConfigFiles({
      configFiles: miseConfigFiles,
      env: terminalEnv,
      paths,
      sandbox,
      signal: input.signal,
    })
    let rawYaml = await rawYamlPromise
    if (rawYaml) {
      void emit({
        kind: "setup",
        message: "Found cloudcode.yaml",
      })
    } else {
      await prepareBuilderCodex(sandbox, paths, input.authJson, input.signal)
      void emit({
        kind: "setup",
        message: "Starting environment scan",
      })
      await runScannerCodex(sandbox, paths, input.signal)
      rawYaml = await readRepoCloudcodeYaml(sandbox, paths)

      if (!rawYaml) {
        throw new Error("Environment scanner did not create cloudcode.yaml.")
      }
      void emit({
        kind: "setup",
        message: "cloudcode.yaml generated",
      })
    }

    let cloudcodeYaml = normalizeCloudcodeYaml(rawYaml)
    const config = parseCloudcodeYaml(cloudcodeYaml)
    addMiseTrustCommand(config, miseConfigFiles)
    cloudcodeYaml = await writeNormalizedCloudcodeYaml({
      config,
      paths,
      sandbox,
    })

    await runCloudcodeCommandList({
      commands: config.global.install,
      cwd: paths.home,
      emit,
      env: terminalEnv,
      label: "Running global environment setup",
      sandbox,
      signal: input.signal,
    })
    await trustMiseConfigFiles({
      configFiles: miseConfigFiles,
      env: terminalEnv,
      paths,
      sandbox,
      signal: input.signal,
    })
    try {
      await runCloudcodeCommandList({
        commands: config.repo.install,
        cwd: paths.repoPath,
        emit,
        env: terminalEnv,
        label: "Running repo install",
        sandbox,
        signal: input.signal,
      })
    } catch (error) {
      if (!needsCxx20CompilerRepair(error)) throw error

      const failedCommand =
        error instanceof CloudcodeCommandError ? error.commandIndex : 0
      await repairCxx20Compiler({
        config,
        emit,
        env: terminalEnv,
        paths,
        sandbox,
        signal: input.signal,
      })
      cloudcodeYaml = await writeNormalizedCloudcodeYaml({
        config,
        paths,
        sandbox,
      })
      await runCloudcodeCommandList({
        commands: config.repo.install,
        cwd: paths.repoPath,
        emit,
        env: terminalEnv,
        label: "Running repo install",
        sandbox,
        signal: input.signal,
        startIndex: failedCommand,
      })
    }

    await writeEnvironmentGitExcludes(sandbox, paths, input.signal)
    const [hashInputs, updatedAuthJson] = await Promise.all([
      readBuildHashInputs(sandbox, paths, input.signal),
      readDaytonaTextFile(sandbox, `${paths.codexHome}/auth.json`).catch(
        () => input.authJson
      ),
    ])
    const configHash = cloudcodeYamlHash(cloudcodeYaml, hashInputs)
    await cleanupBuilderFiles(sandbox, paths, input.signal)

    await completeAutoEnvironmentBuild(
      client,
      {
        buildId: build.buildId,
        cloudcodeYaml,
        configHash,
        sandboxId: sandbox.id,
      },
      input.workerSecret
    )
    keepSandbox = true

    return {
      cloudcodeYaml,
      sandboxId: sandbox.id,
      updatedAuthJson,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Auto environment build failed."
    await failAutoEnvironmentBuild(
      client,
      {
        buildId: build.buildId,
        error: message,
      },
      input.workerSecret
    ).catch(() => undefined)
    throw error
  } finally {
    await buildLogs.flush()
    if (sandbox && !keepSandbox) await deleteDaytonaSandboxQuietly(sandbox.id)
  }
}

function autoPresetForRun(
  preset: SandboxPresetForRun,
  cloudcodeYaml?: string
): SandboxPresetInput {
  return {
    cloudcodeYaml,
    daytonaSnapshot: preset.daytonaSnapshot,
    installScript: undefined,
    name: preset.name,
    pathInstallScript: undefined,
    secrets: preset.secrets,
  }
}

export async function ensureAutoEnvironmentSandbox(
  input: EnsureAutoEnvironmentInput
): Promise<AutoEnvironmentResult> {
  const currentSandboxId = input.currentSandboxId?.trim()
  if (!currentSandboxId) {
    await input.onLog?.({
      kind: "setup",
      message: "Checking auto environment sandbox",
    })
  }
  const client = await getConvexClient(input.workerSecret)
  const existing = await getAutoEnvironmentForRun(client, input)

  if (
    currentSandboxId &&
    existing?.status === "ready" &&
    existing.activeSandboxId === currentSandboxId
  ) {
    return {
      cloudcodeYaml: existing.cloudcodeYaml,
      preparedSandboxFresh: false,
      preset: autoPresetForRun(input.sandboxPreset, existing.cloudcodeYaml),
      requireExistingSandbox: true,
      sandboxId: currentSandboxId,
    }
  }

  let usableActiveSandboxId = existing?.activeSandboxId
  if (usableActiveSandboxId && existing?.status === "ready") {
    try {
      await getStartedDaytonaSandbox(usableActiveSandboxId)
    } catch {
      await input.onLog?.({
        detail: usableActiveSandboxId,
        kind: "setup",
        message: "Prepared auto environment sandbox is unavailable; rebuilding",
      })
      usableActiveSandboxId = undefined
    }
  }

  if (usableActiveSandboxId && existing?.status === "ready") {
    await input.onLog?.({
      detail: usableActiveSandboxId,
      kind: "setup",
      message: "Using prepared auto environment sandbox",
    })
    return {
      cloudcodeYaml: existing.cloudcodeYaml,
      preparedSandboxFresh: false,
      preset: autoPresetForRun(input.sandboxPreset, existing.cloudcodeYaml),
      sandboxId: usableActiveSandboxId,
    }
  }

  const build = await beginAutoEnvironmentBuild(client, input)
  await input.onLog?.({
    detail: build.environmentSlug,
    kind: "setup",
    message: "Preparing auto environment",
  })
  const result = await buildAutoEnvironmentSandbox({
    build,
    client,
    input,
  })

  return {
    cloudcodeYaml: result.cloudcodeYaml,
    preparedSandboxFresh: true,
    preset: autoPresetForRun(input.sandboxPreset, result.cloudcodeYaml),
    sandboxId: result.sandboxId,
    updatedAuthJson: result.updatedAuthJson,
  }
}
