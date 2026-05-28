import type { Sandbox } from "@daytona/sdk"

import {
  getStartedDaytonaSandbox,
  repoCommandEnv,
  resolveDaytonaPaths,
  runDaytonaCommand,
  shellQuote,
  type DaytonaSandboxPaths,
} from "@/lib/daytona-sandbox"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github-auth"
import { parseGitHubRepoUrl, type GitHubRepo } from "@/lib/github-repo"
import { requireCurrentUserSandbox } from "@/lib/sandbox-authorization"
import {
  configureSandboxGitHubRemote,
  setupSandboxGitHubAuth,
  type SandboxGitHubAuth,
} from "@/lib/sandbox-github-auth"

const NO_REPO_MARKER = "__CC_NOREPO__"

export type SandboxGitContext = {
  paths: DaytonaSandboxPaths
  repo: GitHubRepo | null
  repoUrl: string
  sandbox: Sandbox
}

export type SandboxGitFile = {
  code: string
  origPath?: string
  path: string
  staged: boolean
}

export type SandboxGitStatus = {
  ahead: number
  behind: number
  branch: string | null
  detached: boolean
  files: SandboxGitFile[]
  hasRepo: boolean
  sha: string | null
  stagedCount: number
  unstagedCount: number
  untrackedCount: number
  upstream: string | null
}

export async function resolveSandboxGitContext(
  sandboxId: string
): Promise<SandboxGitContext> {
  const { repoUrl } = await requireCurrentUserSandbox(sandboxId)
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  const paths = await resolveDaytonaPaths(sandbox)
  return { paths, repo: parseGitHubRepoUrl(repoUrl), repoUrl, sandbox }
}

/**
 * Sets up the user's GitHub App installation token inside the sandbox for the
 * duration of `fn`, then tears it down. Read-only git commands don't need this;
 * only commit (for author identity) and push (for the credential helper) do.
 */
export async function withSandboxGitHubAuth<T>(
  ctx: SandboxGitContext,
  fn: (env: Record<string, string>) => Promise<T>,
  options: { signal?: AbortSignal } = {}
): Promise<T> {
  const credential = await maybeGetCurrentGitHubRepoCredential(ctx.repoUrl)
  let auth: SandboxGitHubAuth | null = null

  if (credential) {
    auth = await setupSandboxGitHubAuth({
      githubToken: credential.token,
      githubUserEmail: credential.gitUserEmail,
      githubUserName: credential.gitUserName,
      githubUsername: credential.username,
      paths: ctx.paths,
      repoUrl: ctx.repoUrl,
      sandbox: ctx.sandbox,
      signal: options.signal,
    })
    await configureSandboxGitHubRemote({
      auth,
      paths: ctx.paths,
      sandbox: ctx.sandbox,
      signal: options.signal,
    })
  }

  try {
    return await fn(repoCommandEnv(ctx.paths, auth?.env))
  } finally {
    await auth?.cleanup()
  }
}

function section(text: string, start: string, end?: string) {
  const startIndex = text.indexOf(start)
  if (startIndex === -1) return ""
  const from = startIndex + start.length
  if (!end) return text.slice(from).trim()
  const endIndex = text.indexOf(end, from)
  return text.slice(from, endIndex === -1 ? text.length : endIndex).trim()
}

function parsePorcelain(blob: string): SandboxGitFile[] {
  const parts = blob.split("\0")
  const files: SandboxGitFile[] = []

  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i]
    if (!entry || entry.length < 3) continue

    const index = entry[0]
    const worktree = entry[1]
    const path = entry.slice(3)
    let origPath: string | undefined

    if (index === "R" || index === "C") {
      origPath = parts[i + 1] || undefined
      i += 1
    }

    const untracked = index === "?"
    const staged = index !== " " && index !== "?"
    const code = untracked
      ? "U"
      : staged
        ? index
        : worktree !== " "
          ? worktree
          : "M"

    files.push({ code, origPath, path, staged })
  }

  return files
}

export async function readSandboxGitStatus(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  options: { env?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<SandboxGitStatus> {
  const repo = shellQuote(paths.repoPath)
  const command = [
    "set -e",
    `repo=${repo}`,
    `if [ ! -d "$repo/.git" ]; then printf '%s\\n' ${shellQuote(NO_REPO_MARKER)}; exit 0; fi`,
    `printf '__CC_BRANCH__\\n'`,
    `git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null || true`,
    `printf '__CC_SHA__\\n'`,
    `git -C "$repo" rev-parse --short HEAD 2>/dev/null || true`,
    `printf '__CC_UPSTREAM__\\n'`,
    `upstream=$(git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null || true)`,
    `printf '%s\\n' "$upstream"`,
    `printf '__CC_AHEADBEHIND__\\n'`,
    `if [ -n "$upstream" ]; then git -C "$repo" rev-list --left-right --count "@{upstream}...HEAD" 2>/dev/null || true; fi`,
    `printf '\\n__CC_STATUS__\\n'`,
    `git -C "$repo" status --porcelain=v1 -z 2>/dev/null || true`,
  ].join("\n")

  const result = await runDaytonaCommand(sandbox, command, {
    env: options.env ?? repoCommandEnv(paths),
    signal: options.signal,
    timeoutMs: 20_000,
  })

  if (result.stdout.includes(NO_REPO_MARKER)) {
    return {
      ahead: 0,
      behind: 0,
      branch: null,
      detached: false,
      files: [],
      hasRepo: false,
      sha: null,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      upstream: null,
    }
  }

  const [header, statusBlob = ""] = result.stdout.split("__CC_STATUS__\n")
  const branchRaw = section(header, "__CC_BRANCH__\n", "__CC_SHA__")
  const sha = section(header, "__CC_SHA__\n", "__CC_UPSTREAM__") || null
  const upstream =
    section(header, "__CC_UPSTREAM__\n", "__CC_AHEADBEHIND__") || null
  const aheadBehind = section(header, "__CC_AHEADBEHIND__\n")

  const detached = !branchRaw || branchRaw === "HEAD"
  const [behindRaw, aheadRaw] = aheadBehind.split(/\s+/)
  const behind = Number.parseInt(behindRaw ?? "", 10)
  const ahead = Number.parseInt(aheadRaw ?? "", 10)

  const files = parsePorcelain(statusBlob)

  return {
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
    branch: detached ? null : branchRaw,
    detached,
    files,
    hasRepo: true,
    sha,
    stagedCount: files.filter((file) => file.staged).length,
    unstagedCount: files.filter((file) => !file.staged && file.code !== "U")
      .length,
    untrackedCount: files.filter((file) => file.code === "U").length,
    upstream,
  }
}

export async function getCurrentSandboxBranch(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  options: { env?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<string | null> {
  const result = await runDaytonaCommand(
    sandbox,
    `git -C ${shellQuote(paths.repoPath)} rev-parse --abbrev-ref HEAD`,
    {
      env: options.env ?? repoCommandEnv(paths),
      signal: options.signal,
      timeoutMs: 10_000,
    }
  )
  const branch = result.stdout.trim()
  return !branch || branch === "HEAD" ? null : branch
}

export class NothingToCommitError extends Error {
  constructor() {
    super("Nothing to commit.")
    this.name = "NothingToCommitError"
  }
}

export async function commitSandboxChanges(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  env: Record<string, string>,
  message: string,
  options: { signal?: AbortSignal } = {}
): Promise<{ sha: string }> {
  const repo = shellQuote(paths.repoPath)
  const needsIdentity = !env.GIT_AUTHOR_NAME || !env.GIT_AUTHOR_EMAIL
  const identityArgs = needsIdentity
    ? `-c user.name=${shellQuote("Cloudcode")} -c user.email=${shellQuote(
        "cloudcode@users.noreply.github.com"
      )} `
    : ""

  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `git -C ${repo} add -A`,
      `if git -C ${repo} diff --cached --quiet; then printf '__CC_NOTHING__\\n'; exit 0; fi`,
      `git -C ${repo} ${identityArgs}commit -m ${shellQuote(message)}`,
      `git -C ${repo} rev-parse --short HEAD`,
    ].join("\n"),
    { env, signal: options.signal, timeoutMs: 60_000 }
  )

  if (result.stdout.includes("__CC_NOTHING__")) {
    throw new NothingToCommitError()
  }

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || "Unable to commit."
    )
  }

  return { sha: result.stdout.trim().split("\n").pop() ?? "" }
}

export async function pushSandboxBranch(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  env: Record<string, string>,
  branch: string,
  options: { signal?: AbortSignal } = {}
): Promise<void> {
  const result = await runDaytonaCommand(
    sandbox,
    `git -C ${shellQuote(paths.repoPath)} push -u origin ${shellQuote(branch)}`,
    { env, signal: options.signal, timeoutMs: 120_000 }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || "Unable to push."
    )
  }
}
