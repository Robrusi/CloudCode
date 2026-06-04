import { ConvexHttpClient } from "convex/browser"
import type { Sandbox } from "@daytona/sdk"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getConvexAuthToken } from "@/lib/codex-auth"
import { cloudcodeYamlHash, normalizeCloudcodeYaml } from "@/lib/cloudcode-yaml"
import {
  listCloudcodeMiseConfigFiles,
  prepareCloudcodeYamlForSandbox,
  trustCloudcodeMiseConfigFiles,
} from "@/lib/cloudcode-yaml-setup"
import {
  createDaytonaSandbox,
  daytonaCodexPath,
  daytonaTerminalPath,
  defaultDaytonaSnapshot,
  deleteDaytonaSandboxQuietly,
  installDaytonaTarWrapper,
  readDaytonaTextFile,
  resolveDaytonaPaths,
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona-sandbox"
import { cloneGitRepositoryInSandbox } from "@/lib/daytona-git"
import type { RunCodexLog, SandboxPresetInput } from "@/lib/daytona-codex-agent"
import { parseGitHubRepoUrl } from "@/lib/github-repo"
import {
  configureSandboxGitHubRemote,
  setupSandboxGitHubAuth,
  type SandboxGitHubAuth,
} from "@/lib/sandbox-github-auth"
import type { SandboxPresetForRun } from "@/lib/sandbox-presets"

const AUTO_BUILD_SCAN_TIMEOUT_MS = 12 * 60 * 1000
const BUILD_LOG_BATCH_SIZE = 20
const BUILD_LOG_FLUSH_DELAY_MS = 500
const BUILD_LOG_FINAL_FLUSH_TIMEOUT_MS = 2_000

type AutoEnvironmentBuildRecord = {
  buildId: Id<"sandboxPresetBuilds">
  buildNumber: number
  environmentId: Id<"sandboxPresetEnvironments">
  environmentSlug: string
}

type StoredBuildLog = RunCodexLog & { time: number }

export type AutoEnvironmentResult = {
  cloudcodeYaml?: string
  preset: SandboxPresetInput
  sandboxId?: string
  updatedAuthJson?: string
}

export type EnsureAutoEnvironmentInput = {
  authJson: string
  baseBranch?: string
  currentSandboxId?: string
  githubToken?: string
  githubUserEmail?: string
  githubUserName?: string
  githubUsername?: string
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

function githubApiHeaders(token?: string) {
  return {
    accept: "application/vnd.github.raw+json",
    ...(token?.trim() ? { authorization: `Bearer ${token.trim()}` } : {}),
    "x-github-api-version": "2022-11-28",
  }
}

async function readRepoCloudcodeYamlFromGitHub(
  input: EnsureAutoEnvironmentInput
) {
  const repo = parseGitHubRepoUrl(input.repoUrl)
  if (!repo) return undefined

  await input.onLog?.({
    kind: "setup",
    message: "Checking repo cloudcode.yaml",
  })

  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(
      repo.owner
    )}/${encodeURIComponent(repo.repo)}/contents/cloudcode.yaml`
  )
  const baseBranch = input.baseBranch?.trim()
  if (baseBranch) url.searchParams.set("ref", baseBranch)

  const response = await fetch(url, {
    headers: githubApiHeaders(input.githubToken),
    signal: input.signal,
  })

  if (response.status === 404) return undefined
  if (!response.ok) {
    throw new Error(
      `Unable to check repo cloudcode.yaml. GitHub returned ${response.status}.`
    )
  }

  const source = await response.text()
  const cloudcodeYaml = normalizeCloudcodeYaml(source)
  await input.onLog?.({
    kind: "setup",
    message: "Found repo cloudcode.yaml",
  })
  return cloudcodeYaml
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

function presetSecretEnv(preset: SandboxPresetForRun) {
  return Object.fromEntries(
    preset.secrets.map((secret) => [secret.name, secret.value])
  )
}

function codexShellEnv(
  paths: DaytonaSandboxPaths,
  extraEnv: Record<string, string> = {}
) {
  return {
    BASH_ENV: "/dev/null",
    CODEX_HOME: paths.codexHome,
    HOME: paths.runtimeHome,
    MISE_TRUSTED_CONFIG_PATHS: paths.repoPath,
    PATH: daytonaCodexPath(paths),
    SHELL: "/bin/bash",
    ...extraEnv,
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

async function runScannerCodex(
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
        env: codexShellEnv(paths, gitAuth?.env),
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
      env: codexShellEnv(paths, gitAuth?.env),
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
  gitAuth,
  githubToken,
  repoUrl,
  sandbox,
  signal,
  paths,
}: {
  baseBranch?: string
  gitAuth?: SandboxGitHubAuth | null
  githubToken?: string
  repoUrl: string
  sandbox: Sandbox
  signal?: AbortSignal
  paths: DaytonaSandboxPaths
}) {
  await cloneGitRepositoryInSandbox({
    branch: baseBranch,
    env: codexShellEnv(paths, gitAuth?.env),
    password: githubToken,
    path: paths.repoPath,
    repoUrl,
    sandbox,
    signal,
    username: githubToken ? "x-access-token" : undefined,
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
      "# cloudcode auto environment setup",
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
  let gitAuth: SandboxGitHubAuth | null = null
  const buildLogs = createBuildLogEmitter(client, build.buildId, input)
  const emit = buildLogs.emit

  try {
    void emit({
      kind: "setup",
      message: "Creating cloudcode.yaml scan sandbox",
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
      message: "cloudcode.yaml scan sandbox ready",
    })
    gitAuth = await setupSandboxGitHubAuth({
      githubToken: input.githubToken,
      githubUserEmail: input.githubUserEmail,
      githubUserName: input.githubUserName,
      githubUsername: input.githubUsername,
      paths,
      repoUrl: input.repoUrl,
      sandbox,
      signal: input.signal,
    })
    if (gitAuth) Object.assign(terminalEnv, gitAuth.env)
    void emit({
      kind: "setup",
      message: "Cloning repository",
    })
    await cloneRepoForBuild({
      baseBranch: input.baseBranch,
      gitAuth,
      githubToken: input.githubToken,
      repoUrl: input.repoUrl,
      sandbox,
      signal: input.signal,
      paths,
    })
    await configureSandboxGitHubRemote({
      auth: gitAuth,
      paths,
      sandbox,
      signal: input.signal,
    })
    void emit({
      kind: "setup",
      message: "Repository cloned",
    })
    const miseConfigFiles = await listCloudcodeMiseConfigFiles(
      sandbox,
      paths,
      input.signal
    )
    const rawYamlPromise = readRepoCloudcodeYaml(sandbox, paths)
    await trustCloudcodeMiseConfigFiles({
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
      await runScannerCodex(sandbox, paths, gitAuth, input.signal)
      rawYaml = await readRepoCloudcodeYaml(sandbox, paths)

      if (!rawYaml) {
        throw new Error("Environment scanner did not create cloudcode.yaml.")
      }
      void emit({
        kind: "setup",
        message: "cloudcode.yaml generated",
      })
    }

    const { cloudcodeYaml } = await prepareCloudcodeYamlForSandbox({
      cloudcodeYaml: rawYaml,
      configFiles: miseConfigFiles,
      paths,
      sandbox,
    })

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
      },
      input.workerSecret
    )

    return {
      cloudcodeYaml,
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
    await gitAuth?.cleanup()
    await buildLogs.flush()
    if (sandbox) await deleteDaytonaSandboxQuietly(sandbox.id)
  }
}

function autoPresetForRun(
  preset: SandboxPresetForRun,
  cloudcodeYaml?: string
): SandboxPresetInput {
  return {
    cloudcodeYaml,
    daytonaSnapshot: preset.daytonaSnapshot,
    installScript: preset.installScript,
    mode: preset.mode,
    name: preset.name,
    pathInstallScript: preset.pathInstallScript,
    secrets: preset.secrets,
  }
}

export async function ensureAutoEnvironmentSandbox(
  input: EnsureAutoEnvironmentInput
): Promise<AutoEnvironmentResult> {
  const currentSandboxId = input.currentSandboxId?.trim()
  const repoCloudcodeYaml = await readRepoCloudcodeYamlFromGitHub(input)

  if (!currentSandboxId) {
    await input.onLog?.({
      kind: "setup",
      message: "Checking auto environment cloudcode.yaml",
    })
  }
  const client = await getConvexClient(input.workerSecret)
  const existing = await getAutoEnvironmentForRun(client, input)
  const existingCloudcodeYaml = existing?.cloudcodeYaml?.trim()
    ? normalizeCloudcodeYaml(existing.cloudcodeYaml)
    : undefined
  const cloudcodeYamlSource:
    | {
        source: "convex" | "repo"
        yaml: string
      }
    | undefined = repoCloudcodeYaml
    ? {
        source: "repo" as const,
        yaml: repoCloudcodeYaml,
      }
    : existingCloudcodeYaml
      ? {
          source: "convex" as const,
          yaml: existingCloudcodeYaml,
        }
      : undefined

  if (currentSandboxId) {
    const cloudcodeYaml = cloudcodeYamlSource?.yaml
    return {
      cloudcodeYaml,
      preset: autoPresetForRun(input.sandboxPreset, cloudcodeYaml),
      sandboxId: currentSandboxId,
    }
  }

  if (cloudcodeYamlSource) {
    await input.onLog?.({
      kind: "setup",
      message:
        cloudcodeYamlSource.source === "repo"
          ? "Using repo cloudcode.yaml"
          : "Using saved Convex cloudcode.yaml",
    })
    return {
      cloudcodeYaml: cloudcodeYamlSource.yaml,
      preset: autoPresetForRun(input.sandboxPreset, cloudcodeYamlSource.yaml),
    }
  }

  const build = await beginAutoEnvironmentBuild(client, input)
  await input.onLog?.({
    detail: build.environmentSlug,
    kind: "setup",
    message: "Preparing auto environment cloudcode.yaml",
  })
  const result = await buildAutoEnvironmentSandbox({
    build,
    client,
    input,
  })

  return {
    cloudcodeYaml: result.cloudcodeYaml,
    preset: autoPresetForRun(input.sandboxPreset, result.cloudcodeYaml),
    updatedAuthJson: result.updatedAuthJson,
  }
}
