import type { Sandbox } from "@daytona/sdk"

import {
  getRunningCurrentUserDaytonaSandbox,
  getStartedCurrentUserDaytonaSandbox,
} from "@/lib/billing/server"
import {
  repoCommandEnv,
  resolveDaytonaPaths,
  runDaytonaCommand,
  shellQuote,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"
import { maybeGetCurrentGitHubRepoCredential } from "@/lib/github/auth"
import { parseGitHubRepoUrl, type GitHubRepo } from "@/lib/github/repo"
import {
  configureSandboxGitHubRemote,
  setupSandboxGitHubAuth,
  type SandboxGitHubAuth,
} from "@/lib/sandbox/github-auth"

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

export type SandboxGitCommit = {
  additions: number
  authorName: string | null
  deletions: number
  filesChanged: number
  sha: string
  shortSha: string
  subject: string
  /** Author time in epoch milliseconds. */
  timestamp: number | null
}

export type SandboxGitLog = {
  commits: SandboxGitCommit[]
  hasRepo: boolean
  /**
   * "branch": commits ahead of the base branch (the pull request's commits).
   * "recent": plain recent history, used when nothing is ahead of the base.
   */
  scope: "branch" | "recent"
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
  sandboxId: string,
  options: { wakeSandbox?: boolean } = {}
): Promise<SandboxGitContext> {
  // Waking is the default; background reads pass `wakeSandbox: false` so viewing
  // a thread never starts a stopped sandbox (the non-waking getter throws
  // SandboxNotRunningError instead, surfaced as a 409 by gitApiErrorResponse).
  const { access, sandbox } =
    options.wakeSandbox === false
      ? await getRunningCurrentUserDaytonaSandbox(sandboxId)
      : await getStartedCurrentUserDaytonaSandbox(sandboxId)
  const { repoUrl } = access
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

const EMPTY_STATUS: SandboxGitStatus = {
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

// Shell fragments assume `$repo` has been set and the repo exists.
const STATUS_SCRIPT = [
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
]

function parseStatusOutput(output: string): SandboxGitStatus {
  const [header, statusBlob = ""] = output.split("__CC_STATUS__\n")
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

const GIT_LOG_FORMAT = "__CC_COMMIT__%x00%H%x00%h%x00%at%x00%an%x00%s"

const SHORTSTAT_PATTERN =
  /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/

function parseGitLog(blob: string): SandboxGitCommit[] {
  const commits: SandboxGitCommit[] = []

  for (const segment of blob.split("__CC_COMMIT__")) {
    const parts = segment.split("\0")
    if (parts.length < 6) continue

    const sha = parts[1]?.trim()
    const shortSha = parts[2]?.trim()
    if (!sha || !shortSha) continue

    const timestamp = Number.parseInt(parts[3] ?? "", 10)
    const authorName = parts[4]?.trim() || null

    // The subject is the last format field, so the tail holds the subject
    // line followed by this commit's `--shortstat` summary (when non-empty).
    const tail = parts.slice(5).join("\0").split("\n")
    const subject = tail[0]?.trim() ?? ""
    const stat = SHORTSTAT_PATTERN.exec(
      tail.find((line) => SHORTSTAT_PATTERN.test(line)) ?? ""
    )

    commits.push({
      additions: stat?.[2] ? Number.parseInt(stat[2], 10) : 0,
      authorName,
      deletions: stat?.[3] ? Number.parseInt(stat[3], 10) : 0,
      filesChanged: stat?.[1] ? Number.parseInt(stat[1], 10) : 0,
      sha,
      shortSha,
      subject,
      timestamp: Number.isFinite(timestamp) ? timestamp * 1000 : null,
    })
  }

  return commits
}

// Shell fragment; assumes `$repo` and `$base` are set and the repo exists.
// Single-branch clones lack `origin/<base>`; fetch it once (the ref persists)
// so the log range is the pull request's commits rather than plain history.
const LOG_SCRIPT = (() => {
  const format = shellQuote(GIT_LOG_FORMAT)
  return [
    `out=""`,
    `if [ -n "$base" ] && ! git -C "$repo" rev-parse --verify --quiet "origin/$base" >/dev/null 2>&1; then`,
    `  git -C "$repo" fetch origin "+refs/heads/$base:refs/remotes/origin/$base" --no-tags --quiet 2>/dev/null || true`,
    `fi`,
    `if [ -n "$base" ] && git -C "$repo" rev-parse --verify --quiet "origin/$base" >/dev/null 2>&1; then`,
    `  out=$(git -C "$repo" log --shortstat -n 50 --pretty=format:${format} "origin/$base..HEAD" 2>/dev/null || true)`,
    `fi`,
    `if [ -n "$out" ]; then`,
    `  printf '__CC_SCOPE__branch\\n%s\\n' "$out"`,
    `else`,
    `  printf '__CC_SCOPE__recent\\n'`,
    `  git -C "$repo" log --shortstat -n 20 --pretty=format:${format} 2>/dev/null || true`,
    `fi`,
  ]
})()

function parseLogOutput(output: string): SandboxGitLog {
  const scope = output.includes("__CC_SCOPE__branch") ? "branch" : "recent"
  return { commits: parseGitLog(output), hasRepo: true, scope }
}

export type SandboxGitBaseDiff = {
  patch: string
  truncated: boolean
}

export type SandboxGitOverview = {
  /**
   * Diff of the branch against the merge base with `origin/<base>` (the pull
   * request's diff); null when the base ref is unavailable.
   */
  baseDiff: SandboxGitBaseDiff | null
  log: SandboxGitLog | null
  status: SandboxGitStatus
}

const BASE_DIFF_MAX_CHARS = 400_000
const BASE_DIFF_MISSING_MARKER = "__CC_NO_BASE__"

// Shell fragment; assumes `$repo` and `$base` are set (LOG_SCRIPT has already
// fetched `origin/$base` when it was missing) and the repo exists.
const BASE_DIFF_SCRIPT = [
  `if [ -n "$base" ] && git -C "$repo" rev-parse --verify --quiet "origin/$base" >/dev/null 2>&1; then`,
  `  git -C "$repo" diff --no-color "origin/$base...HEAD" 2>/dev/null | head -c 600000`,
  `else`,
  `  printf '%s' ${shellQuote(BASE_DIFF_MISSING_MARKER)}`,
  `fi`,
]

function parseBaseDiffOutput(output: string): SandboxGitBaseDiff | null {
  if (output.includes(BASE_DIFF_MISSING_MARKER)) return null
  let patch = output.replace(/^\n/, "")
  let truncated = false
  if (patch.length > BASE_DIFF_MAX_CHARS) {
    const boundary = patch.lastIndexOf("\ndiff --git", BASE_DIFF_MAX_CHARS)
    patch = patch.slice(0, boundary > 0 ? boundary : BASE_DIFF_MAX_CHARS)
    truncated = true
  }
  return { patch, truncated }
}

export async function readSandboxGitStatus(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  options: { env?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<SandboxGitStatus> {
  const command = [
    `repo=${shellQuote(paths.repoPath)}`,
    `if [ ! -d "$repo/.git" ]; then printf '%s\\n' ${shellQuote(NO_REPO_MARKER)}; exit 0; fi`,
    ...STATUS_SCRIPT,
  ].join("\n")

  const result = await runDaytonaCommand(sandbox, command, {
    env: options.env ?? repoCommandEnv(paths),
    signal: options.signal,
    timeoutMs: 15_000,
  })

  if (result.stdout.includes(NO_REPO_MARKER)) {
    return EMPTY_STATUS
  }

  return parseStatusOutput(result.stdout)
}

/**
 * Status and commit log in a single sandbox command execution. Each remote
 * exec costs a full round trip, so the panel reads everything at once.
 */
export async function readSandboxGitOverview(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  options: {
    baseBranch?: string
    env?: Record<string, string>
    includeDetails?: boolean
    signal?: AbortSignal
  } = {}
): Promise<SandboxGitOverview> {
  if (options.includeDetails === false) {
    return {
      baseDiff: null,
      log: null,
      status: await readSandboxGitStatus(sandbox, paths, options),
    }
  }

  const command = [
    `repo=${shellQuote(paths.repoPath)}`,
    `base=${shellQuote(options.baseBranch ?? "")}`,
    `if [ ! -d "$repo/.git" ]; then printf '%s\\n' ${shellQuote(NO_REPO_MARKER)}; exit 0; fi`,
    ...STATUS_SCRIPT,
    `printf '\\n__CC_LOG__\\n'`,
    ...LOG_SCRIPT,
    `printf '\\n__CC_BASEDIFF__\\n'`,
    ...BASE_DIFF_SCRIPT,
  ].join("\n")

  const result = await runDaytonaCommand(sandbox, command, {
    env: options.env ?? repoCommandEnv(paths),
    signal: options.signal,
    timeoutMs: 25_000,
  })

  if (result.stdout.includes(NO_REPO_MARKER)) {
    return {
      baseDiff: null,
      log: { commits: [], hasRepo: false, scope: "recent" },
      status: EMPTY_STATUS,
    }
  }

  const [statusOutput, rest = ""] = result.stdout.split("__CC_LOG__\n")
  const [logOutput, baseDiffOutput = ""] = rest.split("__CC_BASEDIFF__\n")
  return {
    baseDiff: parseBaseDiffOutput(baseDiffOutput),
    log: parseLogOutput(logOutput),
    status: parseStatusOutput(statusOutput),
  }
}

export type SandboxCommitDiff = {
  diff: string
  hasRepo: boolean
  truncated: boolean
}

/** Keeps huge commits from flooding the client; cut on a file boundary. */
const COMMIT_DIFF_MAX_CHARS = 400_000

export async function readSandboxCommitDiff(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  sha: string,
  options: { env?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<SandboxCommitDiff> {
  const repo = shellQuote(paths.repoPath)
  const command = [
    `repo=${repo}`,
    `if [ ! -d "$repo/.git" ]; then printf '%s\\n' ${shellQuote(NO_REPO_MARKER)}; exit 0; fi`,
    `git -C "$repo" show --no-color --format= --patch ${shellQuote(sha)} 2>/dev/null || true`,
  ].join("\n")

  const result = await runDaytonaCommand(sandbox, command, {
    env: options.env ?? repoCommandEnv(paths),
    signal: options.signal,
    timeoutMs: 30_000,
  })

  if (result.stdout.includes(NO_REPO_MARKER)) {
    return { diff: "", hasRepo: false, truncated: false }
  }

  let diff = result.stdout
  let truncated = false
  if (diff.length > COMMIT_DIFF_MAX_CHARS) {
    const boundary = diff.lastIndexOf("\ndiff --git", COMMIT_DIFF_MAX_CHARS)
    diff = diff.slice(0, boundary > 0 ? boundary : COMMIT_DIFF_MAX_CHARS)
    truncated = true
  }

  return { diff, hasRepo: true, truncated }
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
