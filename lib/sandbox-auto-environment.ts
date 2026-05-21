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
  sandboxId?: string
  updatedAuthJson?: string
}

export type EnsureAutoEnvironmentInput = {
  authJson: string
  baseBranch?: string
  githubToken?: string
  onLog?: (log: RunCodexLog) => void | Promise<void>
  repoUrl: string
  sandboxPreset: SandboxPresetForRun
}

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL

  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before using Convex storage.")
  }

  return url
}

async function getConvexClient() {
  const client = new ConvexHttpClient(getConvexUrl())
  client.setAuth(await getConvexAuthToken())
  return client
}

function compactLine(value: string, max = 260) {
  const line = value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return line.length > max ? `${line.slice(0, max - 3)}...` : line
}

function compactTail(value: string, max = 900) {
  const line = value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
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

    flushPromise = client
      .mutation(api.sandboxPresets.appendAutoEnvironmentBuildLogs, {
        buildId,
        logs,
      })
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

    while ((pending.length > 0 || flushPromise) && Date.now() < deadline) {
      if (pending.length > 0) void flush()
      await (flushPromise ?? Promise.resolve())
    }
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

async function prepareBuilderCodex(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  authJson: string,
  emit: (log: RunCodexLog) => Promise<void>
) {
  await emit({ kind: "setup", message: "Preparing scanner Codex CLI" })
  await runDaytonaCommand(
    sandbox,
    [
      `mkdir -p ${shellQuote(paths.runtimeHome)} ${shellQuote(paths.codexHome)}`,
      `chmod 700 ${shellQuote(paths.runtimeHome)} ${shellQuote(paths.codexHome)}`,
    ].join(" && "),
    { timeoutMs: 10_000 }
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
    onStderr: (chunk) => {
      const message = compactLine(chunk)
      if (message) void emit({ kind: "stderr", message })
    },
    onStdout: (chunk) => {
      const message = compactLine(chunk)
      if (message) void emit({ kind: "stdout", message })
    },
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
    { timeoutMs: 10_000 }
  )
}

function scannerPrompt(repoPath: string) {
  return [
    "You are Cloudcode's automatic environment scanner.",
    "",
    `The repository is already cloned at ${repoPath}. Your current working directory is outside the repository. Keep Codex running outside the repo; use explicit cd commands or absolute paths when you inspect files.`,
    "",
    "Goal: create a valid repo-root cloudcode.yaml that tells Cloudcode exactly what to download/install globally, what to install in the repo, optional commands the agent can run later, and how to start the dev server.",
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
    "Do not prefix every repo, check, dev, or agent command with mise exec -- when the command runs from the repo. Cloudcode puts mise shims first in PATH and runs repo commands from the repo, so bare commands such as bun install --frozen-lockfile and bun run test are preferred after the global mise install step. Use mise exec -- only when a command must run outside the repo or shims are insufficient.",
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
    "agent:",
    "  commands:",
    "    lint: pnpm lint",
    "",
    "Important: for every required language runtime, package manager, SDK, database client, browser, or CLI, include a concrete download/install command in the global list unless you have just verified it already exists in the base snapshot. Do not use metadata-only fields in newly generated YAML.",
    "",
    "Use commands that are realistic for this repo. Prefer frozen lockfile installs when a lockfile exists. Do not include secret values. Do not use package-manager-specific OS dependency flags such as Playwright --with-deps unless you verified that the base snapshot supports the needed package manager; prefer installing only the browser runtime in repo setup and leave OS package repair as an explicit command only when verified. Do not put lint, format, typecheck, test, browser-test, smoke-test, or build commands in checks for environment setup. Put those under agent.commands as shortcuts for the agent to run later when needed. If a command is unsafe, destructive, overly expensive, or requires credentials not present, omit it.",
    "",
    "When finished, make sure cloudcode.yaml parses as YAML and contains concrete run commands.",
  ].join("\n")
}

async function runScannerCodex(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  emit: (log: RunCodexLog) => Promise<void>
) {
  await emit({
    kind: "setup",
    message: "Scanning repo and generating cloudcode.yaml",
  })

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

  await emit({
    kind: "command",
    message: "codex exec environment scanner outside repo",
  })
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
      onStderr: (chunk) => {
        const message = compactLine(chunk)
        if (message) void emit({ kind: "stderr", message })
      },
      onStdout: (chunk) => {
        const message = compactLine(chunk)
        if (message) void emit({ kind: "stdout", message })
      },
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
  paths,
  emit,
}: {
  baseBranch?: string
  githubToken?: string
  repoUrl: string
  sandbox: Sandbox
  paths: DaytonaSandboxPaths
  emit: (log: RunCodexLog) => Promise<void>
}) {
  await emit({
    detail: baseBranch ? `branch ${baseBranch}` : undefined,
    kind: "command",
    message: `git clone ${repoUrl}`,
  })
  await runDaytonaCommand(
    sandbox,
    `rm -rf ${shellQuote(paths.repoPath)} && mkdir -p ${shellQuote(
      paths.repoPath.replace(/\/[^/]+$/, "")
    )}`,
    { timeoutMs: 60_000 }
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
  startIndex = 0,
}: {
  commands: CloudcodeCommand[]
  cwd: string
  emit: (log: RunCodexLog) => Promise<void>
  env: Record<string, string>
  label: string
  sandbox: Sandbox
  startIndex?: number
}) {
  if (commands.length === 0) return

  await emit({
    kind: "setup",
    message: label,
  })

  for (const [index, command] of commands.entries()) {
    if (index < startIndex) continue
    const name = command.name ?? `${label} ${index + 1}`
    await emit({
      kind: "command",
      message: `${name}: ${compactLine(command.run)}`,
    })

    const startedAt = Date.now()
    const heartbeat = setInterval(() => {
      void emit({
        kind: "setup",
        message: `Still running ${name} after ${minutesSince(startedAt)} minute${minutesSince(startedAt) === 1 ? "" : "s"}`,
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
          onStderr: (chunk) => {
            const message = compactLine(chunk)
            if (message) void emit({ kind: "stderr", message })
          },
          onStdout: (chunk) => {
            const message = compactLine(chunk)
            if (message) void emit({ kind: "stdout", message })
          },
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

    await emit({
      kind: "setup",
      message: `${name} completed`,
    })
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
  paths: DaytonaSandboxPaths
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
    { timeoutMs: 10_000 }
  )

  if (result.exitCode !== 0) return []
  return result.stdout
    .split("\n")
    .map((file) => file.trim())
    .filter((file) => MISE_CONFIG_FILES.includes(file))
}

async function trustMiseConfigFiles({
  configFiles,
  emit,
  env,
  paths,
  sandbox,
}: {
  configFiles: string[]
  emit: (log: RunCodexLog) => Promise<void>
  env: Record<string, string>
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
}) {
  if (configFiles.length === 0) return

  await emit({
    detail: configFiles.join(", "),
    kind: "setup",
    message: "Trusting repo mise config",
  })

  const result = await runDaytonaCommand(
    sandbox,
    miseTrustCommand(configFiles),
    {
      cwd: paths.home,
      env,
      onStderr: (chunk) => {
        const message = compactLine(chunk)
        if (message) void emit({ kind: "stderr", message })
      },
      onStdout: (chunk) => {
        const message = compactLine(chunk)
        if (message) void emit({ kind: "stdout", message })
      },
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
}: {
  config: CloudcodeYamlConfig
  emit: (log: RunCodexLog) => Promise<void>
  env: Record<string, string>
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
}) {
  await emit({
    kind: "setup",
    message: "Detected native dependency requiring a C++20 compiler",
  })
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
  })
}

async function readBuildHashInputs(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths
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
    { timeoutMs: 20_000 }
  )
  return result.stdout
}

async function writeEnvironmentGitExcludes(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths
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
    { timeoutMs: 10_000 }
  ).catch(() => undefined)
}

async function cleanupBuilderFiles(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths
) {
  await runDaytonaCommand(
    sandbox,
    `rm -f ${shellQuote(`${paths.codexHome}/auth.json`)} ${shellQuote(
      `${paths.codexHome}/auto-environment-prompt.txt`
    )} ${shellQuote(`${paths.codexHome}/auto-environment-last-message.txt`)}`,
    { timeoutMs: 10_000 }
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
    await emit({
      kind: "setup",
      message: "Creating auto environment builder sandbox",
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

    await emit({
      detail: sandbox.id,
      kind: "setup",
      message: "Auto environment builder sandbox ready",
    })
    await cloneRepoForBuild({
      baseBranch: input.baseBranch,
      githubToken: input.githubToken,
      repoUrl: input.repoUrl,
      sandbox,
      paths,
      emit,
    })
    const miseConfigFiles = await listMiseConfigFiles(sandbox, paths)
    await trustMiseConfigFiles({
      configFiles: miseConfigFiles,
      emit,
      env: terminalEnv,
      paths,
      sandbox,
    })
    await prepareBuilderCodex(sandbox, paths, input.authJson, emit)
    await runScannerCodex(sandbox, paths, emit)

    const rawYaml = await readDaytonaTextFile(
      sandbox,
      `${paths.repoPath}/cloudcode.yaml`
    ).catch(() => "")

    if (!rawYaml.trim()) {
      throw new Error("Environment scanner did not create cloudcode.yaml.")
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
    })
    await trustMiseConfigFiles({
      configFiles: miseConfigFiles,
      emit,
      env: terminalEnv,
      paths,
      sandbox,
    })
    try {
      await runCloudcodeCommandList({
        commands: config.repo.install,
        cwd: paths.repoPath,
        emit,
        env: terminalEnv,
        label: "Running repo install",
        sandbox,
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
      })
      cloudcodeYaml = await writeNormalizedCloudcodeYaml({
        config,
        paths,
        sandbox,
      })
      await emit({
        kind: "setup",
        message: "Retrying repo install after compiler repair",
      })
      await runCloudcodeCommandList({
        commands: config.repo.install,
        cwd: paths.repoPath,
        emit,
        env: terminalEnv,
        label: "Running repo install",
        sandbox,
        startIndex: failedCommand,
      })
    }
    if (config.checks.length > 0) {
      await emit({
        kind: "setup",
        message: "Skipping environment checks during setup",
      })
    }

    await writeEnvironmentGitExcludes(sandbox, paths)
    const hashInputs = await readBuildHashInputs(sandbox, paths)
    const configHash = cloudcodeYamlHash(cloudcodeYaml, hashInputs)
    const updatedAuthJson = await readDaytonaTextFile(
      sandbox,
      `${paths.codexHome}/auth.json`
    ).catch(() => input.authJson)
    await cleanupBuilderFiles(sandbox, paths)

    await client.mutation(api.sandboxPresets.completeAutoEnvironmentBuild, {
      buildId: build.buildId,
      cloudcodeYaml,
      configHash,
      sandboxId: sandbox.id,
    })
    await emit({
      detail: sandbox.id,
      kind: "result",
      message: "Auto environment sandbox ready",
    })
    keepSandbox = true

    return {
      cloudcodeYaml,
      sandboxId: sandbox.id,
      updatedAuthJson,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Auto environment build failed."
    await client
      .mutation(api.sandboxPresets.failAutoEnvironmentBuild, {
        buildId: build.buildId,
        error: message,
      })
      .catch(() => undefined)
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
  await input.onLog?.({
    kind: "setup",
    message: "Checking auto environment sandbox",
  })
  const client = await getConvexClient()
  const existing = (await client.query(
    api.sandboxPresets.getAutoEnvironmentForRun,
    {
      presetId: input.sandboxPreset.id,
      repoUrl: input.repoUrl,
    }
  )) as {
    activeSandboxId?: string
    cloudcodeYaml?: string
    status: string
  } | null

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

  const build = (await client.mutation(
    api.sandboxPresets.beginAutoEnvironmentBuild,
    {
      baseBranch: input.baseBranch,
      presetId: input.sandboxPreset.id,
      repoUrl: input.repoUrl,
    }
  )) as AutoEnvironmentBuildRecord
  await input.onLog?.({
    detail: build.environmentSlug,
    kind: "setup",
    message: "Preparing auto environment from cloudcode.yaml",
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
