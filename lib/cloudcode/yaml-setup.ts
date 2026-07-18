import type { Sandbox } from "@daytona/sdk"

import {
  cloudcodeConfigDirectoryPath,
  cloudcodeYamlPath,
} from "@/lib/cloudcode/config-path"
import {
  cloudcodeYamlHash,
  formatCloudcodeYaml,
  normalizeCloudcodeYaml,
  parseCloudcodeYaml,
  type CloudcodeCommand,
  type CloudcodeYamlConfig,
} from "@/lib/cloudcode/yaml"
import { compactAnsiLine } from "@/lib/shared/compact-line"
import {
  daytonaTerminalPath,
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"

export type CloudcodeSetupLog = {
  detail?: string
  kind: "setup" | "command" | "reasoning" | "stdout" | "stderr" | "result"
  message: string
}

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

const ANSI_ESCAPE_PATTERN = new RegExp(
  String.raw`\u001B\[[0-?]*[ -/]*[@-~]`,
  "g"
)

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

function compactTail(value: string, max = 900) {
  const line = value
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim()
  return line.length > max ? `...${line.slice(-(max - 3))}` : line
}

function commandTimeout(command: CloudcodeCommand) {
  return (command.timeoutMinutes ?? 20) * 60 * 1000
}

function minutesSince(startedAt: number) {
  return Math.max(1, Math.floor((Date.now() - startedAt) / 60_000))
}

const silentCommandOutput = {
  onStderr: () => undefined,
  onStdout: () => undefined,
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
  emit: (log: CloudcodeSetupLog) => Promise<void>
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
      detail: compactAnsiLine(command.run, 500),
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
        detail: output || undefined,
        kind: "result",
        message: `${name} failed with exit code ${result.exitCode}`,
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

export async function listCloudcodeMiseConfigFiles(
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

export async function trustCloudcodeMiseConfigFiles({
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

function normalizeCloudcodeYamlForSetup(source: string, configFiles: string[]) {
  const config = parseCloudcodeYaml(normalizeCloudcodeYaml(source))
  addMiseTrustCommand(config, configFiles)
  return {
    cloudcodeYaml: formatCloudcodeYaml(config),
    config,
  }
}

async function writeNormalizedCloudcodeYaml({
  cloudcodeYaml,
  paths,
  sandbox,
}: {
  cloudcodeYaml: string
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
}) {
  const configDirectory = cloudcodeConfigDirectoryPath(paths.repoPath)
  const createDirectory = await runDaytonaCommand(
    sandbox,
    `mkdir -p ${shellQuote(configDirectory)}`,
    { timeoutMs: 10_000 }
  )
  if (createDirectory.exitCode !== 0) {
    throw new Error(`Unable to create ${configDirectory}.`)
  }

  await writeDaytonaTextFile(
    sandbox,
    cloudcodeYamlPath(paths.repoPath),
    cloudcodeYaml
  )
}

async function repairCxx20Compiler({
  config,
  emit,
  env,
  paths,
  sandbox,
  signal,
  writeCloudcodeYaml,
}: {
  config: CloudcodeYamlConfig
  emit: (log: CloudcodeSetupLog) => Promise<void>
  env: Record<string, string>
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
  signal?: AbortSignal
  writeCloudcodeYaml: boolean
}) {
  addCxx20RepairCommand(config)
  if (writeCloudcodeYaml) {
    await writeNormalizedCloudcodeYaml({
      cloudcodeYaml: formatCloudcodeYaml(config),
      paths,
      sandbox,
    })
  }
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

async function markerMatches(
  sandbox: Sandbox,
  markerPath: string,
  expected: string,
  signal?: AbortSignal
) {
  const result = await runDaytonaCommand(
    sandbox,
    `[ -f ${shellQuote(markerPath)} ] && grep -qxF ${shellQuote(expected)} ${shellQuote(markerPath)}`,
    { signal, timeoutMs: 5_000 }
  ).catch(() => ({ exitCode: 1 }))
  return result.exitCode === 0
}

export async function prepareCloudcodeYamlForSandbox({
  cloudcodeYaml,
  configFiles,
  paths,
  sandbox,
}: {
  cloudcodeYaml: string
  configFiles: string[]
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
}) {
  const prepared = normalizeCloudcodeYamlForSetup(cloudcodeYaml, configFiles)
  await writeNormalizedCloudcodeYaml({
    cloudcodeYaml: prepared.cloudcodeYaml,
    paths,
    sandbox,
  })
  return prepared
}

export async function runCloudcodeYamlSetup({
  cloudcodeYaml,
  configFiles,
  emit,
  env,
  markerPath,
  paths,
  sandbox,
  signal,
  writeCloudcodeYaml = true,
}: {
  cloudcodeYaml: string
  configFiles?: string[]
  emit: (log: CloudcodeSetupLog) => Promise<void>
  env: Record<string, string>
  markerPath?: string
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
  signal?: AbortSignal
  writeCloudcodeYaml?: boolean
}) {
  const detectedConfigFiles =
    configFiles ?? (await listCloudcodeMiseConfigFiles(sandbox, paths, signal))
  const prepared = normalizeCloudcodeYamlForSetup(
    cloudcodeYaml,
    detectedConfigFiles
  )
  if (writeCloudcodeYaml) {
    await writeNormalizedCloudcodeYaml({
      cloudcodeYaml: prepared.cloudcodeYaml,
      paths,
      sandbox,
    })
  }
  let { cloudcodeYaml: normalizedYaml, config } = prepared
  const initialHash = cloudcodeYamlHash(normalizedYaml)

  if (
    markerPath &&
    (await markerMatches(sandbox, markerPath, initialHash, signal))
  ) {
    return {
      cloudcodeYaml: normalizedYaml,
      ran: false,
    }
  }

  await emit({
    kind: "setup",
    message: "Running cloudcode.yaml environment setup",
  })
  await runCloudcodeCommandList({
    commands: config.global.install,
    cwd: paths.home,
    emit,
    env,
    label: "Running global environment setup",
    sandbox,
    signal,
  })
  await trustCloudcodeMiseConfigFiles({
    configFiles: detectedConfigFiles,
    env,
    paths,
    sandbox,
    signal,
  })

  try {
    await runCloudcodeCommandList({
      commands: config.repo.install,
      cwd: paths.repoPath,
      emit,
      env,
      label: "Running repo install",
      sandbox,
      signal,
    })
  } catch (error) {
    if (!needsCxx20CompilerRepair(error)) throw error

    const failedCommand =
      error instanceof CloudcodeCommandError ? error.commandIndex : 0
    await repairCxx20Compiler({
      config,
      emit,
      env,
      paths,
      sandbox,
      signal,
      writeCloudcodeYaml,
    })
    normalizedYaml = formatCloudcodeYaml(config)
    if (writeCloudcodeYaml) {
      await writeNormalizedCloudcodeYaml({
        cloudcodeYaml: normalizedYaml,
        paths,
        sandbox,
      })
    }
    await runCloudcodeCommandList({
      commands: config.repo.install,
      cwd: paths.repoPath,
      emit,
      env,
      label: "Running repo install",
      sandbox,
      signal,
      startIndex: failedCommand,
    })
  }

  normalizedYaml = formatCloudcodeYaml(config)
  if (writeCloudcodeYaml) {
    await writeNormalizedCloudcodeYaml({
      cloudcodeYaml: normalizedYaml,
      paths,
      sandbox,
    })
  }

  if (markerPath) {
    const markerHash = writeCloudcodeYaml
      ? cloudcodeYamlHash(normalizedYaml)
      : initialHash
    await runDaytonaCommand(
      sandbox,
      [
        "set -e",
        `mkdir -p ${shellQuote(paths.codexHome)}`,
        `printf '%s\\n' ${shellQuote(markerHash)} > ${shellQuote(markerPath)}`,
      ].join("\n"),
      {
        cwd: paths.home,
        env: {
          HOME: paths.home,
          PATH: daytonaTerminalPath(paths.home),
        },
        signal,
        timeoutMs: 10_000,
      }
    )
  }

  return {
    cloudcodeYaml: normalizedYaml,
    ran: true,
  }
}
