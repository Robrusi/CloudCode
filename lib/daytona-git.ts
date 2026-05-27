import type { Sandbox } from "@daytona/sdk"

import { runDaytonaCommand, shellQuote } from "@/lib/daytona-sandbox"

type CloneGitRepositoryInSandboxInput = {
  branch?: string
  env?: Record<string, string>
  password?: string
  path: string
  repoUrl: string
  sandbox: Sandbox
  signal?: AbortSignal
  username?: string
}

function compactLine(value: string, max = 220) {
  const line = value.replace(/\s+/g, " ").trim()
  return line.length > max ? `${line.slice(0, max - 3)}...` : line
}

async function cloneableBranch({
  branch,
  env,
  repoUrl,
  sandbox,
  signal,
}: Pick<
  CloneGitRepositoryInSandboxInput,
  "branch" | "env" | "repoUrl" | "sandbox" | "signal"
>) {
  if (!branch) return undefined

  const result = await runDaytonaCommand(
    sandbox,
    `git ls-remote --heads ${shellQuote(repoUrl)}`,
    {
      env,
      signal,
      timeoutMs: 30_000,
    }
  )

  if (result.exitCode === 0 && !result.stdout.trim()) return undefined
  return branch
}

function gitCloneCommand(repoUrl: string, path: string, branch?: string) {
  const branchArgs = branch
    ? `--branch ${shellQuote(branch)} --single-branch `
    : ""
  return `git clone ${branchArgs}${shellQuote(repoUrl)} ${shellQuote(path)}`
}

export async function cloneGitRepositoryInSandbox({
  branch,
  env,
  password,
  path,
  repoUrl,
  sandbox,
  signal,
  username,
}: CloneGitRepositoryInSandboxInput) {
  const parentPath = path.replace(/\/[^/]+$/, "")
  const resolvedBranch = await cloneableBranch({
    branch,
    env,
    repoUrl,
    sandbox,
    signal,
  })

  await runDaytonaCommand(
    sandbox,
    `rm -rf ${shellQuote(path)} && mkdir -p ${shellQuote(parentPath)}`,
    { signal, timeoutMs: 60_000 }
  )

  try {
    await sandbox.git.clone(
      repoUrl,
      path,
      resolvedBranch,
      undefined,
      username,
      password
    )
    return
  } catch {
    const result = await runDaytonaCommand(
      sandbox,
      [
        "set -eo pipefail",
        `rm -rf ${shellQuote(path)}`,
        `mkdir -p ${shellQuote(parentPath)}`,
        gitCloneCommand(repoUrl, path, resolvedBranch),
      ].join("\n"),
      { env, signal, timeoutMs: 5 * 60_000 }
    )

    if (result.exitCode !== 0) {
      throw new Error(
        compactLine(result.stderr || result.stdout) ||
          "Unable to clone repository."
      )
    }
  }
}
