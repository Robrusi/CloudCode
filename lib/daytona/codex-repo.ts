import type { Sandbox } from "@daytona/sdk"

import {
  defaultBranchName,
  defaultBranchNameWithSuffix,
  shuffledCityBranchNames,
} from "@/lib/codex/branch-names"
import { compactLine } from "@/lib/shared/compact-line"
import type { CodexRunLog as RunCodexLog } from "@/lib/codex/run-log"
import { cloneGitRepositoryInSandbox } from "@/lib/daytona/git"
import {
  daytonaTerminalPath,
  miseTrustedConfigPaths,
  repoCommandEnv,
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"
import type { SandboxGitHubAuth } from "@/lib/sandbox/github-auth"

const MISE_CONFIG_FILES = [
  ".mise.toml",
  "mise.toml",
  ".config/mise.toml",
  ".config/mise/config.toml",
]

type DaytonaCodexRepoInput = {
  onLog?: (log: RunCodexLog) => void | Promise<void>
  signal?: AbortSignal
}

async function emitRepoLog(input: DaytonaCodexRepoInput, log: RunCodexLog) {
  await input.onLog?.(log)
}

async function createBranch(
  sandbox: Sandbox,
  input: DaytonaCodexRepoInput,
  paths: DaytonaSandboxPaths,
  branchName: string
) {
  await emitRepoLog(input, {
    kind: "command",
    message: `git checkout -b ${branchName}`,
  })
  try {
    await sandbox.git.createBranch(paths.repoPath, branchName)
  } catch {
    const result = await runDaytonaCommand(
      sandbox,
      `git -C ${shellQuote(paths.repoPath)} checkout -b ${shellQuote(branchName)}`,
      { signal: input.signal, timeoutMs: 10_000 }
    )
    if (result.exitCode !== 0) {
      throw new Error(
        compactLine(result.stderr || result.stdout) ||
          "Unable to create branch."
      )
    }
  }
}

/**
 * `-B` instead of `-b`: continuation runs reuse the thread's branch name, and a
 * recovered sandbox or preset snapshot may still hold that local branch from a
 * previous run. The repo is already reset to the refreshed base and the prior
 * work is replayed via previousDiff, so resetting the leftover branch to HEAD
 * is the intended state — failing on "already exists" would brick the thread.
 */
async function checkoutBranchAtHead(
  sandbox: Sandbox,
  input: DaytonaCodexRepoInput,
  paths: DaytonaSandboxPaths,
  branchName: string
) {
  await emitRepoLog(input, {
    kind: "command",
    message: `git checkout -B ${branchName}`,
  })
  const result = await runDaytonaCommand(
    sandbox,
    `git -C ${shellQuote(paths.repoPath)} checkout -B ${shellQuote(branchName)}`,
    { signal: input.signal, timeoutMs: 10_000 }
  )
  if (result.exitCode !== 0) {
    throw new Error(
      compactLine(result.stderr || result.stdout) || "Unable to create branch."
    )
  }
}

async function readSandboxHeadBranch(
  sandbox: Sandbox,
  input: DaytonaCodexRepoInput,
  paths: DaytonaSandboxPaths
): Promise<string | null> {
  const result = await runDaytonaCommand(
    sandbox,
    `git -C ${shellQuote(paths.repoPath)} rev-parse --abbrev-ref HEAD`,
    { env: repoCommandEnv(paths), signal: input.signal, timeoutMs: 10_000 }
  )
  const branch = result.stdout.trim()
  return branch && branch !== "HEAD" ? branch : null
}

/**
 * "base" mode keeps the run on the branch the clone/refresh already checked out
 * instead of creating a new one. Returns that branch so commits, pushes, and the
 * diff baseline all target it. Falls back to creating a branch only when HEAD is
 * detached (e.g. the base ref is a tag or commit) so there is something to commit
 * onto.
 */
async function resolveBaseModeBranch(
  sandbox: Sandbox,
  input: DaytonaCodexRepoInput,
  paths: DaytonaSandboxPaths,
  baseBranch?: string
): Promise<string> {
  const branch = await readSandboxHeadBranch(sandbox, input, paths)
  if (branch) return branch

  const fallback = baseBranch?.trim() || defaultBranchName()
  await checkoutBranchAtHead(sandbox, input, paths, fallback)
  return fallback
}

async function createDefaultBranch(
  sandbox: Sandbox,
  input: DaytonaCodexRepoInput,
  paths: DaytonaSandboxPaths,
  branchName: string
) {
  const tryCandidates = async (
    candidates: string[],
    index = 0,
    lastError?: unknown
  ): Promise<string> => {
    const candidate = candidates[index]
    if (!candidate) {
      throw lastError instanceof Error
        ? lastError
        : new Error("Unable to create a default branch.")
    }
    try {
      await createBranch(sandbox, input, paths, candidate)
      return candidate
    } catch (error) {
      return tryCandidates(candidates, index + 1, error)
    }
  }

  try {
    return await tryCandidates(shuffledCityBranchNames(branchName))
  } catch (error) {
    return tryCandidates(
      Array.from({ length: 5 }, () => defaultBranchNameWithSuffix()),
      0,
      error
    )
  }
}

function trustMiseCommand(paths: DaytonaSandboxPaths) {
  const markerPath = `${paths.codexHome}/mise-trust.sha256`
  const configFileArgs = MISE_CONFIG_FILES.map(shellQuote).join(" ")

  return [
    "set -e",
    `marker_path=${shellQuote(markerPath)}`,
    `mkdir -p ${shellQuote(paths.codexHome)}`,
    `export MISE_TRUSTED_CONFIG_PATHS=${shellQuote(miseTrustedConfigPaths(paths))}`,
    `cd ${shellQuote(paths.repoPath)}`,
    "hash_file() {",
    "  if command -v sha256sum >/dev/null 2>&1; then",
    "    sha256sum \"$1\" | awk '{print $1}'",
    "  elif command -v shasum >/dev/null 2>&1; then",
    "    shasum -a 256 \"$1\" | awk '{print $1}'",
    "  else",
    "    openssl dgst -sha256 \"$1\" | awk '{print $NF}'",
    "  fi",
    "}",
    "hash_stream() {",
    "  if command -v sha256sum >/dev/null 2>&1; then",
    "    sha256sum | awk '{print $1}'",
    "  elif command -v shasum >/dev/null 2>&1; then",
    "    shasum -a 256 | awk '{print $1}'",
    "  else",
    "    openssl dgst -sha256 | awk '{print $NF}'",
    "  fi",
    "}",
    "has_mise_config=0",
    `for file in ${configFileArgs}; do`,
    '  [ ! -f "$file" ] || has_mise_config=1',
    "done",
    'if [ "$has_mise_config" != "1" ]; then',
    "  config_hash=no-mise-config",
    '  if grep -qxF -- "$config_hash" "$marker_path" 2>/dev/null; then exit 0; fi',
    '  printf "%s\\n" "$config_hash" > "$marker_path"',
    "  exit 0",
    "fi",
    "config_hash=$(",
    "  {",
    `    for file in ${configFileArgs}; do`,
    '      [ -f "$file" ] || continue',
    '      printf "%s\\n" "$file"',
    '      hash_file "$file"',
    "    done",
    "  } | hash_stream",
    ")",
    '[ -n "$config_hash" ]',
    'if grep -qxF -- "$config_hash" "$marker_path" 2>/dev/null; then exit 0; fi',
    "if ! command -v mise >/dev/null 2>&1; then",
    "  curl -fsSL https://mise.run | sh",
    '  export PATH="$HOME/.local/bin:$HOME/.mise/bin:$PATH"',
    "fi",
    ...MISE_CONFIG_FILES.map(
      (file) =>
        `[ ! -f ${shellQuote(file)} ] || mise trust -y ${shellQuote(file)}`
    ),
    'printf "%s\\n" "$config_hash" > "$marker_path"',
  ].join("\n")
}

export async function trustRepoMiseConfig(
  sandbox: Sandbox,
  input: DaytonaCodexRepoInput,
  paths: DaytonaSandboxPaths
) {
  const result = await runDaytonaCommand(sandbox, trustMiseCommand(paths), {
    cwd: paths.home,
    env: {
      HOME: paths.home,
      MISE_TRUSTED_CONFIG_PATHS: miseTrustedConfigPaths(paths),
      MISE_YES: "1",
      PATH: daytonaTerminalPath(paths.home),
    },
    onStderr: (chunk) => {
      const message = compactLine(chunk)
      if (message) void emitRepoLog(input, { kind: "stderr", message })
    },
    onStdout: (chunk) => {
      const message = compactLine(chunk)
      if (message) void emitRepoLog(input, { kind: "stdout", message })
    },
    signal: input.signal,
    timeoutMs: 2 * 60 * 1000,
  })

  if (result.exitCode !== 0) {
    throw new Error(
      compactLine(result.stderr || result.stdout) ||
        "Unable to trust repo mise config."
    )
  }
}

export async function writeBaseRef(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths
) {
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -eo pipefail",
      `cd ${shellQuote(paths.repoPath)}`,
      "git rev-parse --verify HEAD 2>/dev/null || git hash-object -t tree /dev/null",
    ].join("\n"),
    {
      timeoutMs: 10_000,
    }
  )
  const baseRef = result.stdout.trim().split(/\s+/)[0]
  if (result.exitCode !== 0 || !baseRef) {
    throw new Error(
      compactLine(result.stderr || result.stdout) ||
        "Unable to record repo base ref."
    )
  }

  await writeDaytonaTextFile(sandbox, paths.baseRefPath, baseRef)
}

export async function readRepoState(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths
) {
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `if [ ! -d ${shellQuote(`${paths.repoPath}/.git`)} ]; then`,
      "  printf 'missing\\n'",
      "  exit 0",
      "fi",
      "printf 'exists\\n'",
      `git -C ${shellQuote(paths.repoPath)} rev-parse --abbrev-ref HEAD 2>/dev/null || true`,
      `git -C ${shellQuote(paths.repoPath)} remote get-url origin 2>/dev/null || true`,
    ].join("\n"),
    { timeoutMs: 10_000 }
  )
  if (result.exitCode !== 0) return { exists: false, branch: null }

  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim())
  const exists = lines[0] === "exists"
  const branch = exists && lines[1] && lines[1] !== "HEAD" ? lines[1] : null
  const remoteUrl = exists && lines[2] ? lines[2] : null
  return { exists, branch, remoteUrl }
}

/**
 * Checks out the pull request head via `refs/pull/<n>/head`, which lives on
 * the base repository for same-repo and fork PRs alike — no fork remote or
 * head-branch name needed. Assumes the base branch was fetched by the
 * clone/refresh so `origin/<base>` is available as the diff baseline.
 */
async function checkoutPullRequestHead(
  sandbox: Sandbox,
  input: DaytonaCodexRepoInput,
  paths: DaytonaSandboxPaths,
  gitAuth: SandboxGitHubAuth | null | undefined,
  prNumber: number
): Promise<string> {
  const branchName = `pr-${prNumber}`
  await emitRepoLog(input, {
    kind: "command",
    message: `git fetch origin pull/${prNumber}/head`,
  })
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -eo pipefail",
      `cd ${shellQuote(paths.repoPath)}`,
      `git fetch origin ${shellQuote(`pull/${prNumber}/head`)}`,
      `git checkout -B ${shellQuote(branchName)} FETCH_HEAD`,
    ].join("\n"),
    {
      env: repoCommandEnv(paths, gitAuth?.env),
      signal: input.signal,
      timeoutMs: 60_000,
    }
  )
  if (result.exitCode !== 0) {
    throw new Error(
      compactLine(result.stderr || result.stdout) ||
        `Unable to check out pull request #${prNumber}.`
    )
  }

  return branchName
}

export async function cloneRepo({
  baseBranch,
  branchName,
  githubToken,
  input,
  prNumber,
  requestedBranchName,
  repoUrl,
  sandbox,
  paths,
  gitAuth,
  useBaseBranch,
}: {
  baseBranch?: string
  branchName: string
  gitAuth?: SandboxGitHubAuth | null
  githubToken?: string
  input: DaytonaCodexRepoInput
  prNumber?: number
  requestedBranchName?: string
  repoUrl: string
  sandbox: Sandbox
  paths: DaytonaSandboxPaths
  useBaseBranch: boolean
}) {
  const cloneRepository = async () => {
    await emitRepoLog(input, {
      detail: baseBranch ? `branch ${baseBranch}` : undefined,
      kind: "command",
      message: `git clone ${repoUrl}`,
    })
    await cloneGitRepositoryInSandbox({
      branch: baseBranch,
      env: repoCommandEnv(paths, gitAuth?.env),
      password: githubToken,
      path: paths.repoPath,
      repoUrl,
      sandbox,
      signal: input.signal,
      username: githubToken ? "x-access-token" : undefined,
    })
  }

  await cloneRepository()

  if (prNumber) {
    return checkoutPullRequestHead(sandbox, input, paths, gitAuth, prNumber)
  }
  if (useBaseBranch) {
    return resolveBaseModeBranch(sandbox, input, paths, baseBranch)
  }
  if (requestedBranchName) {
    await checkoutBranchAtHead(sandbox, input, paths, requestedBranchName)
    return requestedBranchName
  }
  return createDefaultBranch(sandbox, input, paths, branchName)
}

export async function prepareExistingRepoForFreshRun({
  baseBranch,
  branchName,
  gitAuth,
  input,
  paths,
  prNumber,
  requestedBranchName,
  sandbox,
  useBaseBranch,
}: {
  baseBranch?: string
  branchName: string
  gitAuth?: SandboxGitHubAuth | null
  input: DaytonaCodexRepoInput
  paths: DaytonaSandboxPaths
  prNumber?: number
  requestedBranchName?: string
  sandbox: Sandbox
  useBaseBranch: boolean
}) {
  await emitRepoLog(input, {
    detail: baseBranch ? `branch ${baseBranch}` : undefined,
    kind: "command",
    message: "refresh prepared repo",
  })

  const refreshCommand = [
    "set -eo pipefail",
    `cd ${shellQuote(paths.repoPath)}`,
    "git fetch origin --prune || true",
    baseBranch
      ? [
          `if git show-ref --verify --quiet ${shellQuote(`refs/remotes/origin/${baseBranch}`)}; then`,
          `  git checkout -B ${shellQuote(baseBranch)} ${shellQuote(`origin/${baseBranch}`)}`,
          "elif git rev-parse --verify HEAD >/dev/null 2>&1; then",
          `  git checkout ${shellQuote(baseBranch)}`,
          "fi",
        ].join("\n")
      : [
          "default_branch=$(git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF}' | head -1)",
          'if [ -n "$default_branch" ] && git show-ref --verify --quiet "refs/remotes/origin/$default_branch"; then',
          '  git checkout -B "$default_branch" "origin/$default_branch"',
          "fi",
        ].join("\n"),
    "if git rev-parse --verify HEAD >/dev/null 2>&1; then",
    "  git reset --hard HEAD",
    "else",
    "  git clean -fd",
    "fi",
  ].join("\n")

  const refreshResult = await runDaytonaCommand(sandbox, refreshCommand, {
    env: repoCommandEnv(paths, gitAuth?.env),
    signal: input.signal,
    timeoutMs: 60_000,
  })
  if (refreshResult.exitCode !== 0) {
    await emitRepoLog(input, {
      kind: "stderr",
      message:
        compactLine(refreshResult.stderr || refreshResult.stdout) ||
        "Unable to refresh prepared repo.",
    })
  }

  if (prNumber) {
    return await checkoutPullRequestHead(
      sandbox,
      input,
      paths,
      gitAuth,
      prNumber
    )
  }
  if (useBaseBranch) {
    return await resolveBaseModeBranch(sandbox, input, paths, baseBranch)
  }
  if (requestedBranchName) {
    await checkoutBranchAtHead(sandbox, input, paths, requestedBranchName)
    return requestedBranchName
  }

  return await createDefaultBranch(sandbox, input, paths, branchName)
}
