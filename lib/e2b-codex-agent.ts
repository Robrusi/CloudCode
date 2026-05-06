import { Sandbox } from "e2b"
import {
  activeSandboxTimeoutMs,
  refreshSandboxInactivityTimeout,
  SANDBOX_LIFECYCLE,
} from "./e2b-sandbox-timeout"
import { deleteSandboxSnapshots } from "./e2b-snapshots"
import {
  defaultBranchName,
  defaultBranchNameWithSuffix,
  shuffledCityBranchNames,
} from "./codex-branch-names"
import {
  CLOUDCODE_LEGACY_PRESET_ENV_PATH,
  CLOUDCODE_PRESET_ENV_PATH,
  withoutCloudcodeEnvLocal,
  writeCloudcodeEnvLocal,
  type SandboxPresetEnvVar,
} from "./sandbox-env"
import {
  bunWrapperInstallScript,
  flutterWrapperInstallScript,
  nodeToolWrapperInstallScript,
  resetExecInstallScript,
  smartToolingInstallScript,
} from "./smart-tooling"

const CODEX_HOME = "/home/user/.codex"
const REPO_PATH = "/home/user/repo"
const CLOUDCODE_PROFILE_PATH = "/home/user/.cloudcode-profile"
const PROMPT_PATH = "/tmp/cloudcode-prompt.txt"
const PREVIOUS_DIFF_PATH = "/tmp/cloudcode-previous.diff"
const BASE_REF_PATH = "/tmp/cloudcode-base-ref.txt"
const LAST_MESSAGE_PATH = "/tmp/cloudcode-last-message.txt"
const CODEX_LAUNCHER_PATH = "/tmp/cloudcode-codex-latest"
const PRESET_ENV_PATH = CLOUDCODE_PRESET_ENV_PATH
const RESET_EXEC_PATH = "/home/user/.cloudcode/bin/cloudcode-exec"
const SANDBOX_TEMPLATE = "codex"
const EXIT_MARKER = "__CLOUDCODE_CODEX_EXIT__"
const PRESET_EXIT_MARKER = "__CLOUDCODE_PRESET_EXIT__"
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000
const CODEX_UPDATE_TIMEOUT_MS = 3 * 60 * 1000
const PRESET_INSTALL_TIMEOUT_MS = 20 * 60 * 1000
const SANDBOX_TEMPLATE_BY_SIZE = [
  {
    cpuCount: 2,
    memoryMB: 2048,
    template: process.env.E2B_CODEX_NORMAL_TEMPLATE ?? "codex",
  },
  {
    cpuCount: 4,
    memoryMB: 4096,
    template: process.env.E2B_CODEX_LARGE_TEMPLATE ?? "codex-large",
  },
  {
    cpuCount: 8,
    memoryMB: 8192,
    template: process.env.E2B_CODEX_XLARGE_TEMPLATE ?? "codex-xlarge",
  },
] as const
type CommandResult = {
  exitCode: number
  stderr: string
  stdout: string
}

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh"

export type CodexSpeed = "standard" | "fast"

export type RunCodexLogKind =
  | "setup"
  | "command"
  | "reasoning"
  | "stdout"
  | "stderr"
  | "result"

export type RunCodexLog = {
  detail?: string
  kind: RunCodexLogKind
  message: string
}

export type RunCodexInSandboxInput = {
  authJson: string
  baseBranch?: string
  branchName?: string
  codexThreadId?: string
  githubToken?: string
  onLog?: (log: RunCodexLog) => void | Promise<void>
  model?: string
  previousDiff?: string
  previousSandboxSnapshotId?: string
  prompt: string
  reasoningEffort?: ReasoningEffort
  resumeContext?: string
  repoUrl: string
  sandboxId?: string
  sandboxPreset?: SandboxPresetInput
  speed?: CodexSpeed
  timeoutMs?: number
}

export type SandboxPresetInput = {
  cpuCount: number
  customToolingCommands: string[]
  installScript?: string
  memoryMB: number
  name: string
  secrets: SandboxPresetEnvVar[]
  toolVersions: Array<{
    tool: string
    version: string
  }>
  tools: string[]
}

export type RunCodexInSandboxResult = {
  branchName: string
  codexThreadId?: string
  diff: string
  exitCode: number
  lastMessage: string
  repoUrl: string
  sandboxId: string
  sandboxSnapshotId?: string
  sandboxSnapshotIdsToDelete?: string[]
  stderr: string
  status: string
  stdout: string
  updatedAuthJson: string
  recoveredSandbox: boolean
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function resetExecBashCommand(script: string) {
  return `${shellQuote(RESET_EXEC_PATH)} bash -lc ${shellQuote(script)}`
}

function parseModel(model?: string) {
  const normalized = model?.trim()

  if (!normalized) {
    return undefined
  }

  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(normalized)) {
    throw new Error("Model contains unsupported characters.")
  }

  return normalized
}

function parseReasoningEffort(effort?: string): ReasoningEffort | undefined {
  if (
    effort === "none" ||
    effort === "low" ||
    effort === "medium" ||
    effort === "high" ||
    effort === "xhigh"
  ) {
    return effort
  }

  if (effort) {
    throw new Error(
      "reasoningEffort must be none, low, medium, high, or xhigh."
    )
  }

  return undefined
}

function parseSpeed(speed?: string): CodexSpeed {
  if (!speed || speed === "standard") {
    return "standard"
  }

  if (speed === "fast") {
    return speed
  }

  throw new Error("speed must be standard or fast.")
}

function parseRepoUrl(repoUrl: string) {
  const normalized = repoUrl.trim()

  if (!normalized) {
    throw new Error("repoUrl is required.")
  }

  try {
    const url = new URL(normalized)

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("repoUrl must be an http(s) Git URL.")
    }
  } catch {
    throw new Error("repoUrl must be a valid Git URL.")
  }

  return normalized
}

function parseGitRef(value: string | undefined, label: string) {
  const normalized = value?.trim()

  if (!normalized) {
    return undefined
  }

  if (
    normalized.startsWith("-") ||
    normalized.includes("..") ||
    normalized.includes("//") ||
    !/^[a-zA-Z0-9._/-]{1,120}$/.test(normalized)
  ) {
    throw new Error(`${label} contains unsupported characters.`)
  }

  return normalized
}

function parseOpaqueId(value: string | undefined, label: string) {
  const normalized = value?.trim()

  if (!normalized) {
    return undefined
  }

  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(normalized)) {
    throw new Error(`${label} contains unsupported characters.`)
  }

  return normalized
}

function sandboxTemplateForPreset(preset?: SandboxPresetInput) {
  if (!preset) return SANDBOX_TEMPLATE

  return (
    SANDBOX_TEMPLATE_BY_SIZE.find(
      (size) =>
        size.cpuCount === preset.cpuCount && size.memoryMB === preset.memoryMB
    )?.template ?? SANDBOX_TEMPLATE
  )
}

function sandboxCreateError(error: unknown, template: string) {
  if (
    template !== SANDBOX_TEMPLATE &&
    error instanceof Error &&
    /template .*not found|404/i.test(error.message)
  ) {
    return new Error(
      `E2B template "${template}" was not found. Build that template or set E2B_CODEX_LARGE_TEMPLATE/E2B_CODEX_XLARGE_TEMPLATE to an existing template before using this sandbox size.`
    )
  }

  return error
}

async function createSandbox(
  timeoutMs: number,
  preset?: SandboxPresetInput
) {
  const template = sandboxTemplateForPreset(preset)
  try {
    return await Sandbox.create(template, {
      lifecycle: SANDBOX_LIFECYCLE,
      timeoutMs,
    })
  } catch (error) {
    throw sandboxCreateError(error, template)
  }
}

async function createSandboxFromSnapshot(
  snapshotId: string,
  timeoutMs: number
) {
  return await Sandbox.create(snapshotId, {
    lifecycle: SANDBOX_LIFECYCLE,
    timeoutMs,
  })
}

async function createRestoredOrFreshSandbox(
  snapshotId: string | undefined,
  timeoutMs: number,
  preset?: SandboxPresetInput
) {
  if (snapshotId) {
    try {
      return {
        restoredFromSnapshot: true,
        sandbox: await createSandboxFromSnapshot(snapshotId, timeoutMs),
      }
    } catch {
      return {
        restoredFromSnapshot: false,
        sandbox: await createSandbox(timeoutMs, preset),
      }
    }
  }

  return {
    restoredFromSnapshot: false,
    sandbox: await createSandbox(timeoutMs, preset),
  }
}

async function createBranch(
  sandbox: Awaited<ReturnType<typeof createSandbox>>,
  input: RunCodexInSandboxInput,
  branchName: string
) {
  await emitLog(input, {
    kind: "command",
    message: `git checkout -b ${branchName}`,
  })
  await sandbox.git.createBranch(REPO_PATH, branchName)
}

async function createDefaultBranch(
  sandbox: Awaited<ReturnType<typeof createSandbox>>,
  input: RunCodexInSandboxInput,
  branchName: string
) {
  let lastError: unknown

  for (const candidate of shuffledCityBranchNames(branchName)) {
    try {
      await createBranch(sandbox, input, candidate)
      return candidate
    } catch (error) {
      lastError = error
    }
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = defaultBranchNameWithSuffix()

    try {
      await createBranch(sandbox, input, candidate)
      return candidate
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to create a default branch.")
}

async function connectOrCreateSandbox(
  sandboxId: string | undefined,
  snapshotId: string | undefined,
  timeoutMs: number,
  preset?: SandboxPresetInput
) {
  if (!sandboxId) {
    const { restoredFromSnapshot, sandbox } =
      await createRestoredOrFreshSandbox(snapshotId, timeoutMs, preset)

    return {
      recoveredSandbox: false,
      restoredFromSnapshot,
      sandbox,
    }
  }

  try {
    return {
      recoveredSandbox: false,
      restoredFromSnapshot: false,
      sandbox: await Sandbox.connect(sandboxId),
    }
  } catch {
    const { restoredFromSnapshot, sandbox } =
      await createRestoredOrFreshSandbox(snapshotId, timeoutMs, preset)

    return {
      recoveredSandbox: true,
      restoredFromSnapshot,
      sandbox,
    }
  }
}

async function readLastMessage(sandbox: Sandbox) {
  try {
    return (await sandbox.files.read(LAST_MESSAGE_PATH)).trim()
  } catch {
    return ""
  }
}

async function ensureResetExec(sandbox: Sandbox) {
  await sandbox.commands.run(resetExecInstallScript(), {
    timeoutMs: 10_000,
  })
}

async function getCodexExecHelp(sandbox: Sandbox) {
  try {
    await ensureResetExec(sandbox)
    return (
      await sandbox.commands.run(
        `${shellQuote(RESET_EXEC_PATH)} ${CODEX_LAUNCHER_PATH} exec --help`,
        {
          timeoutMs: 10_000,
        }
      )
    ).stdout
  } catch {
    return ""
  }
}

async function getCodexResumeHelp(sandbox: Sandbox) {
  try {
    await ensureResetExec(sandbox)
    return (
      await sandbox.commands.run(
        `${shellQuote(RESET_EXEC_PATH)} ${CODEX_LAUNCHER_PATH} exec resume --help`,
        {
          timeoutMs: 10_000,
        }
      )
    ).stdout
  } catch {
    return ""
  }
}

async function updateCodexCli(sandbox: Sandbox, input: RunCodexInSandboxInput) {
  await ensureResetExec(sandbox)

  await emitLog(input, {
    kind: "setup",
    message: "Updating Codex CLI to latest",
  })

  const updateCommand = [
    "set -e",
    "if command -v npm >/dev/null 2>&1; then",
    "  npm install -g @openai/codex@latest",
    "elif command -v bun >/dev/null 2>&1; then",
    "  bun install -g @openai/codex@latest",
    "else",
    "  echo 'Neither npm nor bun is available to install the latest Codex CLI.' >&2",
    "  exit 1",
    "fi",
    `cat > ${CODEX_LAUNCHER_PATH} <<'EOF'`,
    "#!/usr/bin/env bash",
    "set -e",
    'exec codex "$@"',
    "EOF",
    `chmod +x ${CODEX_LAUNCHER_PATH}`,
    `${CODEX_LAUNCHER_PATH} --version`,
  ].join("\n")

  await emitLog(input, {
    kind: "command",
    message: "npm install -g @openai/codex@latest",
    detail: "runs once when this app thread initializes its sandbox",
  })

  const result = await sandbox.commands.run(
    resetExecBashCommand(updateCommand),
    {
      onStderr: (data) => {
        const trimmed = compactLine(data)
        if (trimmed) {
          void input.onLog?.({ kind: "stderr", message: trimmed })
        }
      },
      onStdout: (data) => {
        const trimmed = compactLine(data)
        if (trimmed) {
          void input.onLog?.({ kind: "stdout", message: trimmed })
        }
      },
      timeoutMs: CODEX_UPDATE_TIMEOUT_MS,
    }
  )

  const version =
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) || "Codex CLI updated"

  await emitLog(input, {
    kind: "setup",
    message: version,
  })
}

function presetPathExports(preset?: SandboxPresetInput) {
  const paths = [
    "/home/user/.cloudcode/bin",
    "/home/user/repo/node_modules/.bin",
    "/home/user/.bun/bin",
    "/home/user/.local/share/mise/shims",
    "/home/user/.cloudcode/flutter/bin",
    "/home/user/.cargo/bin",
    "/usr/local/go/bin",
    "/home/user/.cloudcode/go/bin",
    "/home/user/go/bin",
    "/home/user/.local/bin",
    "/home/user/.cloudcode/miniconda3/bin",
    "/home/user/.dotnet",
    "/home/user/.cloudcode/zig",
    "/home/user/.cloudcode/swift/usr/bin",
    "/home/user/.cloudcode/kotlinc/bin",
  ]

  return [
    "#!/usr/bin/env bash",
    "trap - CHLD 2>/dev/null || true",
    `export PATH="${paths.join(":")}:$PATH"`,
    'export DOTNET_ROOT="/home/user/.dotnet"',
    'export FLUTTER_ROOT="/home/user/.cloudcode/flutter"',
    'export MISE_PYTHON_GITHUB_ATTESTATIONS=false',
    'export MISE_TRUSTED_CONFIG_PATHS="/home/user/repo"',
    "case $- in",
    "  *i*)",
    '    if [ -z "${CLOUDCODE_SIGCHLD_RESET:-}" ] && [ -x /home/user/.cloudcode/bin/cloudcode-exec ] && [ -x /usr/bin/python3 ]; then',
    "      export CLOUDCODE_SIGCHLD_RESET=1",
    "      exec /home/user/.cloudcode/bin/cloudcode-exec /bin/bash -i",
    "    fi",
    "    ;;",
    "esac",
    ...(preset?.secrets ?? []).map(
      (secret) => `export ${secret.name}=${shellQuote(secret.value)}`
    ),
  ].join("\n")
}

function presetProfileSnippet(preset?: SandboxPresetInput) {
  const exports = presetPathExports(preset)

  return [
    "# Cloudcode preset environment",
    `if [ -f ${shellQuote(CLOUDCODE_PRESET_ENV_PATH)} ]; then`,
    `  . ${shellQuote(CLOUDCODE_PRESET_ENV_PATH)}`,
    "else",
    exports,
    "fi",
  ].join("\n")
}

function miseToolInstallScript(tool: string, version: string) {
  return [
    "if ! command -v mise >/dev/null 2>&1 && [ ! -x /home/user/.local/bin/mise ]; then",
    "  curl https://mise.run | sh",
    "fi",
    'export PATH="/home/user/.local/bin:/home/user/.local/share/mise/shims:$PATH"',
    "mkdir -p /home/user/.config/mise",
    'export MISE_PYTHON_GITHUB_ATTESTATIONS=false',
    "mise settings set python.github_attestations false || true",
    `mise use --global ${shellQuote(`${tool}@${version}`)}`,
    "mise reshim || true",
  ].join("\n")
}

function packageManagerInstallScript(packageSpec: string) {
  const packageName = packageSpec.split("@")[0] || packageSpec
  return [
    "PACKAGE_MANAGER_READY=0",
    `PACKAGE_SPEC=${shellQuote(packageSpec)}`,
    `PACKAGE_NAME=${shellQuote(packageName)}`,
    `PACKAGE_REQUESTED_VERSION=${shellQuote(
      packageSpec.includes("@") ? packageSpec.split("@").slice(1).join("@") : ""
    )}`,
    'package_manager_path() {',
    '  if command -v mise >/dev/null 2>&1; then',
    '    MISE_NODE_ROOT="$(mise where node 2>/dev/null || true)"',
    '    if [ -n "$MISE_NODE_ROOT" ]; then',
    '      MISE_PACKAGE_MANAGER="$MISE_NODE_ROOT/bin/$PACKAGE_NAME"',
    '      if [ -x "$MISE_PACKAGE_MANAGER" ]; then printf "%s\\n" "$MISE_PACKAGE_MANAGER"; return 0; fi',
    "    fi",
    '    for MISE_PACKAGE_MANAGER in /home/user/.local/share/mise/installs/node/*/bin/$PACKAGE_NAME; do',
    '      if [ -x "$MISE_PACKAGE_MANAGER" ]; then printf "%s\\n" "$MISE_PACKAGE_MANAGER"; return 0; fi',
    "    done",
    "  fi",
    '  SEARCH_PATH="$(printf "%s" "$PATH" | tr ":" "\\n" | grep -vx "/home/user/.cloudcode/bin" | paste -sd: -)"',
    '  PATH="$SEARCH_PATH" command -v "$PACKAGE_NAME" 2>/dev/null || true',
    "}",
    'package_manager_version_matches() {',
    '  if [ -z "$PACKAGE_REQUESTED_VERSION" ] || [ "$PACKAGE_REQUESTED_VERSION" = "latest" ]; then return 0; fi',
    '  if ! printf "%s" "$PACKAGE_REQUESTED_VERSION" | grep -Eq "^[0-9]+[.][0-9]+[.][0-9]+$"; then return 0; fi',
    '  ACTUAL_VERSION="$("$1" --version 2>/dev/null | head -n 1 | tr -d "[:space:]")"',
    '  [ "$ACTUAL_VERSION" = "$PACKAGE_REQUESTED_VERSION" ]',
    "}",
    "if command -v corepack >/dev/null 2>&1; then",
    "  corepack enable || true",
    `  if corepack prepare ${shellQuote(packageSpec)} --activate; then`,
    '    PACKAGE_MANAGER_BIN="$(package_manager_path)"',
    '    if [ -n "$PACKAGE_MANAGER_BIN" ] && package_manager_version_matches "$PACKAGE_MANAGER_BIN"; then PACKAGE_MANAGER_READY=1; fi',
    "  fi",
    "fi",
    'if [ "$PACKAGE_MANAGER_READY" != "1" ] && command -v npm >/dev/null 2>&1; then',
    '  rm -f "$(npm bin -g 2>/dev/null)/$PACKAGE_NAME" 2>/dev/null || true',
    '  SEARCH_PATH="$(printf "%s" "$PATH" | tr ":" "\\n" | grep -vx "/home/user/.cloudcode/bin" | paste -sd: -)"',
    '  REAL_NODE="$(PATH="$SEARCH_PATH" command -v node 2>/dev/null || true)"',
    '  if command -v mise >/dev/null 2>&1; then REAL_NODE="$(mise where node 2>/dev/null)/bin/node"; fi',
    '  if [ -n "$REAL_NODE" ]; then rm -f "$(dirname "$REAL_NODE")/$PACKAGE_NAME" 2>/dev/null || true; fi',
    `  npm install -g --force ${shellQuote(packageSpec)}`,
    "  mise reshim || true",
    "fi",
    'PACKAGE_MANAGER_BIN="$(package_manager_path)"',
    'if [ -z "$PACKAGE_MANAGER_BIN" ] || ! package_manager_version_matches "$PACKAGE_MANAGER_BIN"; then',
    '  echo "$PACKAGE_NAME is not installed after attempting $PACKAGE_SPEC." >&2',
    "  exit 127",
    "fi",
    '"$PACKAGE_MANAGER_BIN" --version',
  ].join("\n")
}

function presetToolInstallScript(tool: string, version?: string) {
  if (tool === "auto-detect") {
    return smartToolingInstallScript()
  }

  if (tool === "bun") {
    if (version) {
      return [
        miseToolInstallScript("bun", version),
        bunWrapperInstallScript(),
        'export PATH="/home/user/.cloudcode/bin:/home/user/.bun/bin:/home/user/.local/share/mise/shims:$PATH"',
        "bun --version",
      ].join("\n")
    }

    return [
      "if ! command -v bun >/dev/null 2>&1; then",
      "  curl -fsSL https://bun.sh/install | bash",
      "fi",
      bunWrapperInstallScript(),
      'export PATH="/home/user/.cloudcode/bin:/home/user/.bun/bin:$PATH"',
      "bun --version",
    ].join("\n")
  }

  if (tool === "flutter") {
    const flutterVersion = version || "stable"
    return [
      "mkdir -p /home/user/.cloudcode",
      "if [ ! -d /home/user/.cloudcode/flutter/.git ]; then",
      `  git clone --depth 1 --branch ${shellQuote(flutterVersion)} https://github.com/flutter/flutter.git /home/user/.cloudcode/flutter || git clone --depth 1 --branch stable https://github.com/flutter/flutter.git /home/user/.cloudcode/flutter`,
      "else",
      `  git -C /home/user/.cloudcode/flutter fetch --depth 1 origin ${shellQuote(flutterVersion)} || git -C /home/user/.cloudcode/flutter fetch --depth 1 origin stable`,
      `  git -C /home/user/.cloudcode/flutter checkout ${shellQuote(flutterVersion)} || git -C /home/user/.cloudcode/flutter checkout stable`,
      "fi",
      flutterWrapperInstallScript(),
      'export PATH="/home/user/.cloudcode/bin:/home/user/.cloudcode/flutter/bin:$PATH"',
      "flutter --version",
    ].join("\n")
  }

  if (tool === "node" || tool === "node-pnpm") {
    return [
      ...(version
        ? [
            miseToolInstallScript("node", version),
            nodeToolWrapperInstallScript(),
            'export PATH="/home/user/.cloudcode/bin:/home/user/.local/share/mise/shims:$PATH"',
          ]
        : []),
      "node --version",
    ].join("\n")
  }

  if (tool === "pnpm") {
    const packageSpec = version ? `pnpm@${version}` : "pnpm@latest"
    return packageManagerInstallScript(packageSpec)
  }

  if (tool === "python") {
    if (version) {
      return [
        miseToolInstallScript("python", version),
        'export PATH="/home/user/.local/share/mise/shims:$PATH"',
        "python --version",
        "python -m pip --version || true",
      ].join("\n")
    }

    return [
      "if command -v python3 >/dev/null 2>&1; then",
      "  python3 --version",
      "else",
      "  python --version",
      "fi",
      "if command -v pip3 >/dev/null 2>&1; then pip3 --version; fi",
    ].join("\n")
  }

  if (tool === "go") {
    if (version) {
      return [
        miseToolInstallScript("go", version),
        'export PATH="/home/user/.local/share/mise/shims:$PATH"',
        "go version",
      ].join("\n")
    }

    return [
      "if ! command -v go >/dev/null 2>&1 && [ ! -x /home/user/.cloudcode/go/bin/go ]; then",
      "  mkdir -p /home/user/.cloudcode",
      '  GO_ARCH="$(uname -m)"',
      '  case "$GO_ARCH" in',
      '    x86_64) GO_ARCH="amd64" ;;',
      '    aarch64|arm64) GO_ARCH="arm64" ;;',
      "  esac",
      '  GO_VERSION="$(curl -fsSL https://go.dev/VERSION?m=text | head -n1)"',
      '  curl -fsSL "https://go.dev/dl/${GO_VERSION}.linux-${GO_ARCH}.tar.gz" -o /tmp/go.tar.gz',
      "  rm -rf /home/user/.cloudcode/go",
      "  tar -xzf /tmp/go.tar.gz -C /home/user/.cloudcode",
      "  rm -f /tmp/go.tar.gz",
      "fi",
      'export PATH="/home/user/.cloudcode/go/bin:$PATH"',
      "go version",
    ].join("\n")
  }

  if (tool === "rust") {
    return [
      "if ! command -v rustup >/dev/null 2>&1; then",
      "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
      "fi",
      'export PATH="/home/user/.cargo/bin:$PATH"',
      ...(version
        ? [
            `rustup toolchain install ${shellQuote(version)}`,
            `rustup default ${shellQuote(version)}`,
          ]
        : []),
      "rustc --version",
      "cargo --version",
    ].join("\n")
  }

  if (tool === "uv") {
    return [
      "if ! command -v uv >/dev/null 2>&1; then",
      "  curl -LsSf https://astral.sh/uv/install.sh | sh",
      "fi",
      'export PATH="/home/user/.local/bin:$PATH"',
      "uv --version",
    ].join("\n")
  }

  if (tool === "conda") {
    return [
      "if [ ! -x /home/user/.cloudcode/miniconda3/bin/conda ]; then",
      "  mkdir -p /home/user/.cloudcode",
      "  curl -fsSL https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -o /tmp/miniconda.sh",
      "  bash /tmp/miniconda.sh -b -p /home/user/.cloudcode/miniconda3",
      "  rm -f /tmp/miniconda.sh",
      "fi",
      'export PATH="/home/user/.cloudcode/miniconda3/bin:$PATH"',
      "conda --version",
    ].join("\n")
  }

  if (tool === "ruby") {
    if (version) {
      return [
        miseToolInstallScript("ruby", version),
        'export PATH="/home/user/.local/share/mise/shims:$PATH"',
        "ruby --version",
        "gem --version",
      ].join("\n")
    }

    return [
      "if ! command -v ruby >/dev/null 2>&1; then",
      "  sudo apt-get update -y",
      "  sudo apt-get install -y ruby-full",
      "fi",
      "ruby --version",
      "gem --version",
    ].join("\n")
  }

  if (tool === "java") {
    if (version) {
      return [
        miseToolInstallScript("java", version),
        'export PATH="/home/user/.local/share/mise/shims:$PATH"',
        "java -version",
        "javac -version",
      ].join("\n")
    }

    return [
      "if ! command -v java >/dev/null 2>&1; then",
      "  sudo apt-get update -y",
      "  sudo apt-get install -y default-jdk",
      "fi",
      "java -version",
      "javac -version",
    ].join("\n")
  }

  if (tool === "kotlin") {
    const kotlinVersion = version || ""
    return [
      "if ! command -v java >/dev/null 2>&1; then",
      "  echo 'Kotlin requires Java. Enable the Java preset tool as well.' >&2",
      "  exit 1",
      "fi",
      "if [ ! -x /home/user/.cloudcode/kotlinc/bin/kotlin ]; then",
      "  mkdir -p /home/user/.cloudcode",
      kotlinVersion
        ? `  KOTLIN_VERSION=${shellQuote(kotlinVersion)}`
        : '  KOTLIN_VERSION="$(curl -fsSL https://api.github.com/repos/JetBrains/kotlin/releases/latest | python3 -c "import json,sys; print(json.load(sys.stdin)[\\"tag_name\\"].lstrip(\\"v\\"))")"',
      '  curl -fsSL "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip" -o /tmp/kotlin.zip',
      "  command -v unzip >/dev/null 2>&1 || sudo apt-get install -y unzip",
      "  rm -rf /home/user/.cloudcode/kotlinc",
      "  unzip -q /tmp/kotlin.zip -d /home/user/.cloudcode",
      "  rm -f /tmp/kotlin.zip",
      "fi",
      'export PATH="/home/user/.cloudcode/kotlinc/bin:$PATH"',
      "kotlin -version",
    ].join("\n")
  }

  if (tool === "dotnet") {
    const dotnetInstallArg = version
      ? /^\d/.test(version)
        ? `--version ${shellQuote(version)}`
        : `--channel ${shellQuote(version)}`
      : "--channel LTS"
    return [
      "if ! command -v dotnet >/dev/null 2>&1; then",
      "  curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh",
      `  bash /tmp/dotnet-install.sh ${dotnetInstallArg} --install-dir /home/user/.dotnet`,
      "  rm -f /tmp/dotnet-install.sh",
      "fi",
      'export DOTNET_ROOT="/home/user/.dotnet"',
      'export PATH="/home/user/.dotnet:$PATH"',
      "dotnet --version",
    ].join("\n")
  }

  if (tool === "elixir") {
    if (version) {
      return [
        miseToolInstallScript("elixir", version),
        'export PATH="/home/user/.local/share/mise/shims:$PATH"',
        "elixir --version",
      ].join("\n")
    }

    return [
      "if ! command -v elixir >/dev/null 2>&1; then",
      "  sudo apt-get update -y",
      "  sudo apt-get install -y elixir",
      "fi",
      "elixir --version",
    ].join("\n")
  }

  if (tool === "zig") {
    if (version) {
      return [
        miseToolInstallScript("zig", version),
        'export PATH="/home/user/.local/share/mise/shims:$PATH"',
        "zig version",
      ].join("\n")
    }

    return [
      "if ! command -v zig >/dev/null 2>&1; then",
      "  mkdir -p /home/user/.cloudcode",
      '  ZIG_ARCH="$(uname -m)"',
      '  ZIG_TARBALL="$(curl -fsSL https://ziglang.org/download/index.json | python3 -c "import json,sys; data=json.load(sys.stdin); print(data[\\"master\\"][\\"${ZIG_ARCH}-linux\\"][\\"tarball\\"])")"',
      '  curl -fsSL "$ZIG_TARBALL" -o /tmp/zig.tar.xz',
      "  rm -rf /home/user/.cloudcode/zig",
      "  mkdir -p /home/user/.cloudcode/zig",
      "  tar -xJf /tmp/zig.tar.xz -C /home/user/.cloudcode/zig --strip-components=1",
      "  rm -f /tmp/zig.tar.xz",
      "fi",
      'export PATH="/home/user/.cloudcode/zig:$PATH"',
      "zig version",
    ].join("\n")
  }

  if (tool === "swift") {
    const swiftVersion = version || "6.0.3"
    return [
      "if [ ! -x /home/user/.cloudcode/swift/usr/bin/swift ]; then",
      "  sudo apt-get update -y",
      "  sudo apt-get install -y binutils git gnupg2 libc6-dev libcurl4-openssl-dev libedit2 libpython3-dev libsqlite3-0 libxml2-dev libz3-dev pkg-config tzdata unzip zlib1g-dev",
      "  mkdir -p /home/user/.cloudcode",
      `  SWIFT_VERSION=${shellQuote(swiftVersion)}`,
      '  SWIFT_DIR="ubuntu2204"',
      '  SWIFT_FILE="ubuntu22.04"',
      '  SWIFT_URL="https://download.swift.org/swift-${SWIFT_VERSION}-release/${SWIFT_DIR}/swift-${SWIFT_VERSION}-RELEASE/swift-${SWIFT_VERSION}-RELEASE-${SWIFT_FILE}.tar.gz"',
      '  curl -fL "$SWIFT_URL" -o /tmp/swift.tar.gz',
      "  rm -rf /home/user/.cloudcode/swift",
      "  mkdir -p /home/user/.cloudcode/swift",
      "  tar -xzf /tmp/swift.tar.gz -C /home/user/.cloudcode/swift --strip-components=1",
      "  rm -f /tmp/swift.tar.gz",
      "fi",
      'export PATH="/home/user/.cloudcode/swift/usr/bin:$PATH"',
      "swift --version",
    ].join("\n")
  }

  return ""
}

async function prepareSandboxPresetRuntime(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  options: { installToolWrappers?: boolean } = {}
) {
  const installToolWrappers = options.installToolWrappers ?? true
  await ensureResetExec(sandbox)

  if (!input.sandboxPreset) return

  if (!installToolWrappers) {
    await sandbox.commands
      .run(
        "rm -f /home/user/.cloudcode/bin/bun /home/user/.cloudcode/bin/node /home/user/.cloudcode/bin/npm /home/user/.cloudcode/bin/pnpm /home/user/.cloudcode/bin/yarn /home/user/.cloudcode/bin/flutter /home/user/.cloudcode/bin/dart",
        { timeoutMs: 10_000 }
      )
      .catch(() => undefined)
  }

  await sandbox.commands
    .run(
      `mkdir -p ${shellQuote(CODEX_HOME)} && rm -f ${shellQuote(PRESET_ENV_PATH)} ${shellQuote(CLOUDCODE_LEGACY_PRESET_ENV_PATH)}`,
      {
        timeoutMs: 10_000,
      }
    )
    .catch(() => undefined)
  await sandbox.files.write(
    PRESET_ENV_PATH,
    presetPathExports(input.sandboxPreset)
  )
  if (installToolWrappers) {
    await sandbox.commands.run(bunWrapperInstallScript(), {
      timeoutMs: 10_000,
    })
    await sandbox.commands.run(nodeToolWrapperInstallScript(), {
      timeoutMs: 10_000,
    })
  }
  await sandbox.commands.run(`chmod 600 ${shellQuote(PRESET_ENV_PATH)}`, {
    timeoutMs: 10_000,
  })
  await sandbox.files.write(
    CLOUDCODE_PROFILE_PATH,
    presetProfileSnippet(input.sandboxPreset)
  )
  await sandbox.commands.run(
    [
      `chmod 644 ${shellQuote(CLOUDCODE_PROFILE_PATH)}`,
      `grep -qxF '. ${CLOUDCODE_PROFILE_PATH}' /home/user/.bashrc 2>/dev/null || printf '\\n. ${CLOUDCODE_PROFILE_PATH}\\n' >> /home/user/.bashrc`,
      `grep -qxF '. ${CLOUDCODE_PROFILE_PATH}' /home/user/.profile 2>/dev/null || printf '\\n. ${CLOUDCODE_PROFILE_PATH}\\n' >> /home/user/.profile`,
    ].join(" && "),
    {
      timeoutMs: 10_000,
    }
  )
}

async function installSandboxPreset(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput
) {
  const preset = input.sandboxPreset
  if (!preset) return

  await emitLog(input, {
    kind: "setup",
    message: `Preparing preset: ${preset.name}`,
  })

  await prepareSandboxPresetRuntime(sandbox, input, {
    installToolWrappers: false,
  })

  const toolVersionById = new Map(
    preset.toolVersions.map((item) => [item.tool, item.version])
  )
  const installBlocks = [
    "set -e",
    "export HOME=/home/user",
    `. ${PRESET_ENV_PATH}`,
    ...preset.tools
      .map((tool) => {
        const script = presetToolInstallScript(tool, toolVersionById.get(tool))
        if (!script) return ""
        const workingDir = tool === "auto-detect" ? REPO_PATH : "/home/user"
        return [
          `echo "::cloudcode-preset-tool::${tool}"`,
          `cd ${workingDir}`,
          script,
        ].join("\n")
      })
      .filter(Boolean),
    ...preset.customToolingCommands.map((command, index) =>
      [
        `echo "::cloudcode-preset-custom-tool::${index + 1}"`,
        "# Custom tooling command",
        "cd /home/user",
        command,
      ].join("\n")
    ),
    preset.installScript
      ? [
          "# Custom preset install script",
          `cd ${REPO_PATH}`,
          preset.installScript,
        ].join("\n")
      : "",
    `. ${PRESET_ENV_PATH}`,
  ].filter(Boolean)

  if (installBlocks.length <= 4) return

  const installCommand = installBlocks.join("\n\n")

  await emitLog(input, {
    kind: "command",
    message: `install preset ${preset.name}`,
    detail: "runs when a fresh sandbox starts with this preset",
  })

  const { exitCode, result } = await runPresetInstallCommand(
    sandbox,
    input,
    installCommand
  )

  if (exitCode !== 0) {
    const rawStdout = result.stdout.replace(
      new RegExp(`\\n?${PRESET_EXIT_MARKER}\\d+\\s*$`),
      ""
    )
    const output = [
      ...tailCompactLines(result.stderr),
      ...tailCompactLines(rawStdout),
    ].slice(-30)

    const lastToolMarker = rawStdout.match(/::cloudcode-preset-tool::([^\n]+)/g)
    const failingTool = lastToolMarker?.at(-1)?.split("::").at(-1)?.trim()

    console.error(
      `[preset-install] "${preset.name}" failed (exit ${exitCode})\n--- stderr ---\n${result.stderr}\n--- stdout ---\n${rawStdout}\n--- script ---\n${installCommand}`
    )

    throw new Error(
      [
        `Preset "${preset.name}" failed during install with exit code ${exitCode}.`,
        failingTool ? `Failing tool: ${failingTool}` : "",
        exitCode === 137
          ? "The install process was killed by the sandbox. This usually means the custom install script used too much memory or CPU. Remove heavy dependency installs like `bun install` from the preset script; let Codex run them later when needed."
          : "",
        output.length
          ? output.join("\n")
          : "(No output captured. See server log for full stderr/stdout/script.)",
      ]
        .filter(Boolean)
        .join("\n")
    )
  }

  await emitLog(input, {
    kind: "setup",
    message: `Preset ready: ${preset.name}`,
  })
}

async function runPresetInstallCommand(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  installCommand: string
) {
  const wrappedInstallCommand = [
    "set +e",
    "(",
    installCommand,
    ")",
    "code=$?",
    `printf '\\n${PRESET_EXIT_MARKER}%s\\n' \"$code\"`,
    "exit 0",
  ].join("\n")

  let result: CommandResult

  try {
    result = await sandbox.commands.run(
      resetExecBashCommand(wrappedInstallCommand),
      {
        envs: {
          HOME: "/home/user",
        },
        onStderr: (data) => {
          const trimmed = compactLine(data)
          if (trimmed) {
            void input.onLog?.({ kind: "stderr", message: trimmed })
          }
        },
        onStdout: (data) => {
          const trimmed = compactLine(data)
          if (trimmed) {
            void input.onLog?.({ kind: "stdout", message: trimmed })
          }
        },
        timeoutMs: PRESET_INSTALL_TIMEOUT_MS,
      }
    )
  } catch (error) {
    const failedResult = commandErrorResult(error)
    if (!failedResult) throw error
    result = failedResult
  }

  const markerMatch = result.stdout.match(
    new RegExp(`\\n?${PRESET_EXIT_MARKER}(\\d+)`)
  )

  return {
    exitCode: markerMatch ? Number(markerMatch[1]) : result.exitCode,
    result,
  }
}

function commandErrorResult(error: unknown): CommandResult | undefined {
  const result = (error as { result?: Partial<CommandResult> })?.result

  if (!result || typeof result.exitCode !== "number") return undefined

  return {
    exitCode: result.exitCode,
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  }
}

async function isCodexLauncherReady(sandbox: Sandbox) {
  try {
    const result = await sandbox.commands.run(
      `test -x ${CODEX_LAUNCHER_PATH}`,
      {
        timeoutMs: 10_000,
      }
    )
    return result.exitCode === 0
  } catch {
    return false
  }
}

function helpIncludes(help: string, flag: string) {
  return help.includes(flag)
}

async function emitLog(input: RunCodexInSandboxInput, log: RunCodexLog) {
  await input.onLog?.(log)
}

function compactLine(value: string, max = 220) {
  const line = value.replace(/\s+/g, " ").trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function tailCompactLines(value: string, maxLines = 8) {
  return value
    .split(/\r?\n/)
    .map((line) => compactLine(line, 300))
    .filter(Boolean)
    .slice(-maxLines)
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return undefined
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readableCodexText(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown
    const nested = findString(parsed, ["detail", "message", "error"])
    return nested && nested !== value ? readableCodexText(nested) : value
  } catch {
    return value
  }
}

function codexThreadIdFromEvent(event: unknown) {
  const record = objectRecord(event)
  if (!record) return undefined

  const type = stringValue(record.type)
  const threadId = stringValue(record.thread_id)
  return type === "thread.started" ? threadId : undefined
}

function findString(
  value: unknown,
  keys: readonly string[],
  depth = 0
): string | undefined {
  const record = objectRecord(value)
  if (!record || depth > 3) return undefined

  for (const key of keys) {
    const found = stringValue(record[key])
    if (found) return found
  }

  for (const nested of Object.values(record)) {
    const found = findString(nested, keys, depth + 1)
    if (found) return found
  }

  return undefined
}

function summarizeCodexEvent(event: unknown): RunCodexLog | undefined {
  const record = objectRecord(event)
  if (!record) return undefined

  const type = stringValue(record.type)?.toLowerCase() ?? ""
  const status = stringValue(record.status)
  const command = findString(record, ["command", "cmd", "shell_command"])
  const text = findString(record, [
    "summary",
    "message",
    "text",
    "content",
    "delta",
  ])

  if (type.includes("reason")) {
    return {
      kind: "reasoning",
      message: text ? compactLine(readableCodexText(text)) : "Reasoning",
    }
  }

  if (
    command &&
    (type.includes("command") ||
      type.includes("exec") ||
      type.includes("tool") ||
      type.includes("function"))
  ) {
    return {
      kind: "command",
      message: compactLine(command),
      detail: status,
    }
  }

  if (type.includes("turn") && (type.includes("start") || status)) {
    return {
      kind: "setup",
      message: status ? `Codex turn ${status}` : "Codex turn started",
    }
  }

  if (type.includes("error")) {
    return {
      kind: "stderr",
      message: text
        ? compactLine(readableCodexText(text))
        : "Codex reported an error",
    }
  }

  return undefined
}

function summarizeUnknownCodexEvent(event: unknown): RunCodexLog | undefined {
  const record = objectRecord(event)
  if (!record) return undefined

  const type = stringValue(record.type)
  if (!type) return undefined

  const status = stringValue(record.status)
  const text = findString(record, [
    "summary",
    "message",
    "text",
    "content",
    "delta",
    "reason",
    "detail",
  ])

  if (!text && !status) return undefined

  return {
    kind: type.toLowerCase().includes("error") ? "stderr" : "stdout",
    message: compactLine([type, status, text].filter(Boolean).join(": ")),
  }
}

function createStdoutLogger(
  onLog: RunCodexInSandboxInput["onLog"],
  onCodexThreadId: (threadId: string) => void
) {
  let buffer = ""

  function emitPlainLine(line: string) {
    const trimmed = compactLine(line)
    if (!trimmed || trimmed.startsWith(EXIT_MARKER)) return
    void onLog?.({ kind: "stdout", message: trimmed })
  }

  function flushLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return

    try {
      const event = JSON.parse(trimmed) as unknown
      const threadId = codexThreadIdFromEvent(event)
      if (threadId) onCodexThreadId(threadId)
      const summary = summarizeCodexEvent(event)
      if (summary) {
        void onLog?.(summary)
      } else {
        const fallback = summarizeUnknownCodexEvent(event)
        if (fallback) void onLog?.(fallback)
      }
    } catch {
      emitPlainLine(trimmed)
    }
  }

  return {
    chunk(data: string) {
      buffer += data
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""
      for (const line of lines) flushLine(line)
    },
    flush() {
      if (buffer) flushLine(buffer)
      buffer = ""
    },
  }
}

function redactAuthPathOutput(result: CommandResult) {
  const exitPattern = new RegExp(`\\n?${EXIT_MARKER}(\\d+)\\s*$`)
  const exitMatch = result.stdout.match(exitPattern)
  const exitCode = exitMatch?.[1] ? Number(exitMatch[1]) : result.exitCode

  return {
    ...result,
    exitCode,
    stderr: result.stderr.replaceAll(CODEX_HOME, "$CODEX_HOME"),
    stdout: result.stdout
      .replace(exitPattern, "")
      .replaceAll(CODEX_HOME, "$CODEX_HOME"),
  }
}

function restoredConversationPrompt(context: string, prompt: string) {
  return [
    "The previous sandbox expired, so this is a fresh sandbox. Previous sandbox state has been restored when available. Use this handoff as the current task state and continue from it.",
    context.trim(),
    "Current user request:",
    prompt,
  ].join("\n\n")
}

async function writeBaseRef(sandbox: Sandbox) {
  const result = await sandbox.commands.run(
    `git -C ${REPO_PATH} rev-parse HEAD`,
    {
      timeoutMs: 10_000,
    }
  )
  await sandbox.files.write(BASE_REF_PATH, result.stdout.trim())
}

async function cleanupRunFiles(sandbox: Sandbox) {
  await sandbox.commands
    .run(
      `rm -f ${CODEX_HOME}/auth.json ${PROMPT_PATH} ${PREVIOUS_DIFF_PATH} ${LAST_MESSAGE_PATH}`,
      {
        timeoutMs: 10_000,
      }
    )
    .catch(() => undefined)
}

async function createSandboxSnapshot(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput
) {
  await emitLog(input, {
    kind: "command",
    message: "snapshot sandbox",
  })

  try {
    const snapshot = await sandbox.createSnapshot()
    const cleanup = await deleteSandboxSnapshots(
      [input.previousSandboxSnapshotId],
      snapshot.snapshotId
    )

    for (const message of Object.values(cleanup.errors)) {
      await emitLog(input, {
        kind: "stderr",
        message: compactLine(message),
      })
    }

    return {
      sandboxSnapshotId: snapshot.snapshotId,
      sandboxSnapshotIdsToDelete: cleanup.deferredIds,
    }
  } catch (error) {
    await emitLog(input, {
      kind: "stderr",
      message:
        error instanceof Error
          ? compactLine(error.message)
          : "Unable to snapshot sandbox.",
    })
  }

  return {
    sandboxSnapshotId: undefined,
    sandboxSnapshotIdsToDelete: [],
  }
}

export async function runCodexInSandbox(input: RunCodexInSandboxInput) {
  const model = parseModel(input.model)
  const reasoningEffort = parseReasoningEffort(input.reasoningEffort)
  const repoUrl = parseRepoUrl(input.repoUrl)
  const baseBranch = parseGitRef(input.baseBranch, "baseBranch")
  const requestedBranchName = parseGitRef(input.branchName, "branchName")
  let branchName = requestedBranchName ?? defaultBranchName()
  const githubToken = input.githubToken?.trim() || process.env.GITHUB_TOKEN
  const speed = parseSpeed(input.speed)
  const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  const sandboxTimeoutMs = activeSandboxTimeoutMs(timeoutMs)
  const existingCodexThreadId = parseGitRef(
    input.codexThreadId,
    "codexThreadId"
  )
  const previousSandboxSnapshotId = parseOpaqueId(
    input.previousSandboxSnapshotId,
    "previousSandboxSnapshotId"
  )
  const sandboxTemplate = sandboxTemplateForPreset(input.sandboxPreset)
  await emitLog(input, {
    kind: "setup",
    message: input.sandboxId
      ? "Connecting to sandbox"
      : previousSandboxSnapshotId
        ? "Creating sandbox from snapshot"
        : `Creating ${sandboxTemplate} sandbox`,
  })
  const { recoveredSandbox, restoredFromSnapshot, sandbox } =
    await connectOrCreateSandbox(
      input.sandboxId,
      previousSandboxSnapshotId,
      sandboxTimeoutMs,
      input.sandboxPreset
    )
  try {
    const info = await sandbox.getInfo()
    await emitLog(input, {
      kind: "setup",
      message: `Sandbox resources: ${info.cpuCount} CPU, ${Math.round(info.memoryMB / 1024)} GB RAM`,
      detail: info.templateId,
    })
  } catch {
    // Resource reporting is diagnostic only; sandbox setup can continue.
  }
  await emitLog(input, {
    kind: "setup",
    message: restoredFromSnapshot
      ? "Sandbox restored from previous snapshot"
      : recoveredSandbox
        ? "Recovered with a fresh sandbox"
        : "Sandbox ready",
    detail: sandbox.sandboxId,
  })
  await sandbox.setTimeout(sandboxTimeoutMs)

  try {
    const codexThreadIdToResume =
      input.sandboxId && !recoveredSandbox ? existingCodexThreadId : undefined
    const shouldRestoreConversation = Boolean(
      existingCodexThreadId && !codexThreadIdToResume
    )
    const prompt =
      shouldRestoreConversation && input.resumeContext?.trim()
        ? restoredConversationPrompt(input.resumeContext, input.prompt)
        : input.prompt
    const needsCodexSetup =
      !input.sandboxId ||
      recoveredSandbox ||
      !(await isCodexLauncherReady(sandbox))

    if (needsCodexSetup) {
      await updateCodexCli(sandbox, input)
    }
    await emitLog(input, { kind: "setup", message: "Preparing Codex auth" })
    await sandbox.commands.run(
      `mkdir -p ${CODEX_HOME} && chmod 700 ${CODEX_HOME}`
    )
    await sandbox.files.write(`${CODEX_HOME}/auth.json`, input.authJson)
    await sandbox.files.write(PROMPT_PATH, prompt)
    await sandbox.commands.run(
      `chmod 600 ${CODEX_HOME}/auth.json ${PROMPT_PATH}`
    )

    if ((!input.sandboxId || recoveredSandbox) && !restoredFromSnapshot) {
      await emitLog(input, {
        kind: "command",
        message: `git clone ${repoUrl}`,
        detail: baseBranch ? `branch ${baseBranch}` : undefined,
      })
      await sandbox.git.clone(repoUrl, {
        branch: baseBranch,
        depth: 1,
        password: githubToken,
        path: REPO_PATH,
        username: githubToken ? "x-access-token" : undefined,
      })
      if (requestedBranchName) {
        await createBranch(sandbox, input, requestedBranchName)
      } else {
        branchName = await createDefaultBranch(sandbox, input, branchName)
      }
      await writeBaseRef(sandbox)
      if (input.previousDiff?.trim()) {
        await emitLog(input, {
          kind: "command",
          message: "git apply previous changes",
        })
        await sandbox.files.write(PREVIOUS_DIFF_PATH, input.previousDiff)
        await sandbox.commands.run(
          `git -C ${REPO_PATH} apply --whitespace=nowarn ${PREVIOUS_DIFF_PATH}`,
          {
            timeoutMs: 60_000,
          }
        )
      }
      await installSandboxPreset(sandbox, input)
    } else {
      await emitLog(input, {
        kind: "command",
        message: `test -d ${REPO_PATH}/.git`,
      })
      await sandbox.commands.run(`test -d ${REPO_PATH}/.git`, {
        timeoutMs: 10_000,
      })
    }

    await prepareSandboxPresetRuntime(sandbox, input)
    if (input.sandboxPreset?.secrets.length) {
      await emitLog(input, {
        kind: "setup",
        message: `Writing ${input.sandboxPreset.secrets.length} preset secret${input.sandboxPreset.secrets.length === 1 ? "" : "s"} to .env.local`,
      })
      await writeCloudcodeEnvLocal(
        sandbox,
        REPO_PATH,
        input.sandboxPreset.secrets
      )
    }

    await emitLog(input, {
      kind: "setup",
      message: "Reading Codex CLI capabilities",
    })
    const help = await getCodexExecHelp(sandbox)
    const resumeHelp = codexThreadIdToResume
      ? await getCodexResumeHelp(sandbox)
      : ""
    const modelFlag =
      model && (helpIncludes(help, "--model") || helpIncludes(help, "-m,"))
        ? `--model ${shellQuote(model)}`
        : ""
    const resumeModelFlag =
      model &&
      resumeHelp &&
      (helpIncludes(resumeHelp, "--model") || helpIncludes(resumeHelp, "-m,"))
        ? `--model ${shellQuote(model)}`
        : ""
    const configFlags = [
      reasoningEffort && helpIncludes(help, "--config")
        ? `-c ${shellQuote(`model_reasoning_effort="${reasoningEffort}"`)}`
        : "",
      speed === "fast" && helpIncludes(help, "--config")
        ? `-c ${shellQuote('service_tier="fast"')}`
        : "",
    ]
      .filter(Boolean)
      .join(" ")
    const resumeConfigFlags = [
      reasoningEffort && helpIncludes(resumeHelp, "--config")
        ? `-c ${shellQuote(`model_reasoning_effort="${reasoningEffort}"`)}`
        : "",
      speed === "fast" && helpIncludes(resumeHelp, "--config")
        ? `-c ${shellQuote('service_tier="fast"')}`
        : "",
    ]
      .filter(Boolean)
      .join(" ")
    const optionalFlags = [
      helpIncludes(help, "--dangerously-bypass-approvals-and-sandbox")
        ? "--dangerously-bypass-approvals-and-sandbox"
        : "",
      !helpIncludes(help, "--dangerously-bypass-approvals-and-sandbox") &&
      helpIncludes(help, "--sandbox")
        ? "--sandbox danger-full-access"
        : "",
      helpIncludes(help, "--full-auto") ? "--full-auto" : "",
      helpIncludes(help, "--skip-git-repo-check")
        ? "--skip-git-repo-check"
        : "",
      helpIncludes(help, "--ignore-user-config") ? "--ignore-user-config" : "",
      helpIncludes(help, "--ignore-rules") ? "--ignore-rules" : "",
      helpIncludes(help, "--json") ? "--json" : "",
    ]
      .filter(Boolean)
      .join(" ")
    const resumeOptionalFlags = [
      helpIncludes(resumeHelp, "--dangerously-bypass-approvals-and-sandbox")
        ? "--dangerously-bypass-approvals-and-sandbox"
        : "",
      helpIncludes(resumeHelp, "--full-auto") ? "--full-auto" : "",
      helpIncludes(resumeHelp, "--skip-git-repo-check")
        ? "--skip-git-repo-check"
        : "",
      helpIncludes(resumeHelp, "--ignore-user-config")
        ? "--ignore-user-config"
        : "",
      helpIncludes(resumeHelp, "--ignore-rules") ? "--ignore-rules" : "",
      helpIncludes(resumeHelp, "--json") ? "--json" : "",
    ]
      .filter(Boolean)
      .join(" ")
    const outputFlag = helpIncludes(help, "--output-last-message")
      ? `--output-last-message ${LAST_MESSAGE_PATH}`
      : ""
    const resumeOutputFlag = helpIncludes(resumeHelp, "--output-last-message")
      ? `--output-last-message ${LAST_MESSAGE_PATH}`
      : ""
    const cdFlag =
      helpIncludes(help, "--cd") || helpIncludes(help, "-C,")
        ? `-C ${REPO_PATH}`
        : ""
    const cdCommand = cdFlag ? "" : `cd ${REPO_PATH} &&`
    const codexCommand = codexThreadIdToResume
      ? [
          `cd ${REPO_PATH} &&`,
          `CODEX_HOME=${CODEX_HOME}`,
          `${CODEX_LAUNCHER_PATH} exec resume`,
          resumeOptionalFlags,
          resumeConfigFlags,
          resumeModelFlag,
          resumeOutputFlag,
          shellQuote(codexThreadIdToResume),
          "-",
          `< ${PROMPT_PATH}`,
        ]
          .filter(Boolean)
          .join(" ")
      : [
          cdCommand,
          `CODEX_HOME=${CODEX_HOME}`,
          `${CODEX_LAUNCHER_PATH} exec`,
          optionalFlags,
          configFlags,
          modelFlag,
          outputFlag,
          cdFlag,
          `< ${PROMPT_PATH}`,
        ]
          .filter(Boolean)
          .join(" ")
    const command = [
      "set +e",
      `[ -f ${PRESET_ENV_PATH} ] && . ${PRESET_ENV_PATH}`,
      codexCommand,
      "code=$?",
      `printf '\\n${EXIT_MARKER}%s\\n' \"$code\"`,
      "exit 0",
    ].join("\n")

    await emitLog(input, {
      kind: "command",
      message: compactLine(codexCommand),
    })
    let codexThreadId = codexThreadIdToResume
    const stdoutLogger = createStdoutLogger(input.onLog, (threadId) => {
      codexThreadId = threadId
    })
    const result = redactAuthPathOutput(
      await sandbox.commands.run(resetExecBashCommand(command), {
        envs: {
          CODEX_HOME,
          HOME: "/home/user",
          ...Object.fromEntries(
            (input.sandboxPreset?.secrets ?? []).map((secret) => [
              secret.name,
              secret.value,
            ])
          ),
        },
        onStderr: (data) => {
          const trimmed = compactLine(data)
          if (trimmed) {
            void input.onLog?.({ kind: "stderr", message: trimmed })
          }
        },
        onStdout: (data) => stdoutLogger.chunk(data),
        timeoutMs,
      })
    )
    stdoutLogger.flush()

    await emitLog(input, {
      detail: String(result.exitCode),
      kind: result.exitCode === 0 ? "setup" : "stderr",
      message: `Codex exited with code ${result.exitCode}`,
    })

    await emitLog(input, {
      kind: "command",
      message: "git diff --binary base",
    })
    const lastMessage = await readLastMessage(sandbox)
    const updatedAuthJson = await sandbox.files.read(`${CODEX_HOME}/auth.json`)
    await cleanupRunFiles(sandbox)
    const { diff, snapshot, status } = await withoutCloudcodeEnvLocal(
      sandbox,
      REPO_PATH,
      async () => {
        const diff = (
          await sandbox.commands.run(
            `base_ref=$(cat ${BASE_REF_PATH} 2>/dev/null || git -C ${REPO_PATH} rev-parse HEAD); git -C ${REPO_PATH} add -N . >/dev/null 2>&1 || true; git -C ${REPO_PATH} diff --binary "$base_ref"`,
            {
              timeoutMs: 60_000,
            }
          )
        ).stdout
        await emitLog(input, {
          kind: "command",
          message: "git status --short --branch",
        })
        const status = (
          await sandbox.commands.run(
            `git -C ${REPO_PATH} status --short --branch`,
            {
              timeoutMs: 60_000,
            }
          )
        ).stdout
        await emitLog(input, {
          kind: "result",
          message:
            result.exitCode === 0
              ? "Codex run completed"
              : `Codex exited with code ${result.exitCode}`,
        })
        const snapshot = await createSandboxSnapshot(sandbox, input)

        return { diff, snapshot, status }
      }
    )

    return {
      branchName,
      codexThreadId,
      diff,
      exitCode: result.exitCode,
      lastMessage,
      repoUrl,
      sandboxId: sandbox.sandboxId,
      sandboxSnapshotId: snapshot.sandboxSnapshotId,
      sandboxSnapshotIdsToDelete: snapshot.sandboxSnapshotIdsToDelete,
      stderr: result.stderr,
      status,
      stdout: result.stdout,
      updatedAuthJson,
      recoveredSandbox,
    } satisfies RunCodexInSandboxResult
  } finally {
    try {
      await cleanupRunFiles(sandbox)
    } finally {
      await refreshSandboxInactivityTimeout(sandbox).catch(() => {})
    }
  }
}
