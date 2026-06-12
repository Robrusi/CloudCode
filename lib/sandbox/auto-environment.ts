import type { Sandbox } from "@daytona/sdk"

import { codexShellEnv, presetSecretEnv } from "@/lib/daytona/codex-runtime"
import { cloudcodeYamlHash, normalizeCloudcodeYaml } from "@/lib/cloudcode/yaml"
import {
  listCloudcodeMiseConfigFiles,
  prepareCloudcodeYamlForSandbox,
  trustCloudcodeMiseConfigFiles,
} from "@/lib/cloudcode/yaml-setup"
import {
  createDaytonaSandbox,
  daytonaTerminalPath,
  miseTrustedConfigPaths,
  defaultDaytonaSnapshot,
  deleteDaytonaSandboxQuietly,
  readDaytonaTextFile,
  resolveDaytonaPaths,
  runDaytonaCommand,
  shellQuote,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"
import { cloneGitRepositoryInSandbox } from "@/lib/daytona/git"
import type { CodexRunLog as RunCodexLog } from "@/lib/codex/run-log"
import type { SandboxPresetInput } from "@/lib/daytona/codex-agent-types"
import { parseGitHubRepoUrl } from "@/lib/github/repo"
import {
  configureSandboxGitHubRemote,
  setupSandboxGitHubAuth,
  type SandboxGitHubAuth,
} from "@/lib/sandbox/github-auth"
import {
  prepareBuilderCodex,
  runScannerCodex,
} from "@/lib/sandbox/auto-environment-scanner"
import {
  beginAutoEnvironmentBuild,
  completeAutoEnvironmentBuild,
  createBuildLogEmitter,
  failAutoEnvironmentBuild,
  getAutoEnvironmentConvexClient,
  getAutoEnvironmentForRun,
  type AutoEnvironmentBuildRecord,
  type AutoEnvironmentConvexClient,
} from "@/lib/sandbox/auto-environment-store"
import type { SandboxPresetForRun } from "@/lib/sandbox/presets"

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

function githubApiHeaders(token?: string) {
  return {
    accept: "application/vnd.github.raw+json",
    ...(token?.trim() ? { authorization: `Bearer ${token.trim()}` } : {}),
    "x-github-api-version": "2022-11-28",
  }
}

async function readRepoCloudcodeYamlFromGitHub({
  input,
  logCheck,
}: {
  input: EnsureAutoEnvironmentInput
  logCheck: boolean
}) {
  const repo = parseGitHubRepoUrl(input.repoUrl)
  if (!repo) return undefined

  if (logCheck) {
    await input.onLog?.({
      kind: "setup",
      message: "Checking repo cloudcode.yaml",
    })
  }

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
    env: codexShellEnv(paths, {
      extraEnv: gitAuth?.env,
      includeTarOptions: false,
    }),
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
  client: AutoEnvironmentConvexClient
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
      MISE_TRUSTED_CONFIG_PATHS: miseTrustedConfigPaths(paths),
      MISE_YES: "1",
      PATH: daytonaTerminalPath(paths.home),
      TAR_OPTIONS: "--no-same-owner --no-same-permissions",
      ...presetSecretEnv(input.sandboxPreset.secrets),
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
  const repoCloudcodeYaml = await readRepoCloudcodeYamlFromGitHub({
    input,
    logCheck: !currentSandboxId,
  })

  if (!currentSandboxId) {
    await input.onLog?.({
      kind: "setup",
      message: "Checking auto environment cloudcode.yaml",
    })
  }
  const client = await getAutoEnvironmentConvexClient(input.workerSecret)
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
