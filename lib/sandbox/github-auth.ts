import { randomBytes } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import {
  daytonaTerminalPath,
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"

export type SandboxGitHubAuth = {
  cleanup: () => Promise<void>
  env: Record<string, string>
  remoteUrl: string | null
  tokenPath: string
}

function gitHubRemoteUrl(repoUrl: string) {
  const sshMatch = repoUrl
    .trim()
    .match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i)
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}.git`
  }

  try {
    const url = new URL(repoUrl)
    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:" &&
      url.protocol !== "ssh:"
    ) {
      return null
    }
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com")
      return null

    const match = url.pathname
      .replace(/\/+$/, "")
      .match(/^\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/)

    if (!match) return null

    return `https://github.com/${match[1]}/${match[2]}.git`
  } catch {
    return null
  }
}

function credentialPaths(paths: DaytonaSandboxPaths) {
  const dir = `${paths.runtimeHome}/.cloudcode-github`
  const ghConfigDir = `${dir}/gh`
  return {
    dir,
    ghConfigDir,
    ghHostsPath: `${ghConfigDir}/hosts.yml`,
    homeGhConfigDir: `${paths.home}/.config/gh`,
    homeGhHostsPath: `${paths.home}/.config/gh/hosts.yml`,
    runtimeGhConfigDir: `${paths.runtimeHome}/.config/gh`,
    runtimeGhHostsPath: `${paths.runtimeHome}/.config/gh/hosts.yml`,
    helperPath: `${dir}/git-credential-cloudcode-github`,
    tokenPath: `${dir}/token`,
  }
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths)]
}

function terminalHomeEnv(paths: DaytonaSandboxPaths) {
  return {
    HOME: paths.home,
    PATH: daytonaTerminalPath(paths.home),
  }
}

function gitGlobalCleanupCommands(home: string) {
  const homeEnv = `HOME=${shellQuote(home)}`
  return [
    `case "$(${homeEnv} git config --global --get credential.https://github.com.helper || true)" in *cloudcode-github*|*cloudcode*) ${homeEnv} git config --global --unset-all credential.https://github.com.helper || true ;; esac`,
    `${homeEnv} git config --global --unset-all credential.https://github.com.useHttpPath || true`,
    `${homeEnv} git config --global --unset-all url.https://github.com/.insteadOf ${shellQuote(
      "^git@github\\.com:$"
    )} || true`,
    `${homeEnv} git config --global --unset-all url.https://github.com/.insteadOf ${shellQuote(
      "^ssh://git@github\\.com/$"
    )} || true`,
  ]
}

function gitGlobalSetupCommands({
  cleanGitUserEmail,
  cleanGitUserName,
  helperCommand,
  home,
}: {
  cleanGitUserEmail?: string
  cleanGitUserName?: string
  helperCommand: string
  home: string
}) {
  const homeEnv = `HOME=${shellQuote(home)}`
  return [
    `${homeEnv} git config --global --unset-all url.https://github.com/.insteadOf ${shellQuote(
      "^git@github\\.com:$"
    )} || true`,
    `${homeEnv} git config --global --unset-all url.https://github.com/.insteadOf ${shellQuote(
      "^ssh://git@github\\.com/$"
    )} || true`,
    `${homeEnv} git config --global --add url.https://github.com/.insteadOf git@github.com:`,
    `${homeEnv} git config --global --add url.https://github.com/.insteadOf ssh://git@github.com/`,
    cleanGitUserName
      ? `${homeEnv} git config --global user.name ${shellQuote(cleanGitUserName)}`
      : "",
    cleanGitUserEmail
      ? `${homeEnv} git config --global user.email ${shellQuote(cleanGitUserEmail)}`
      : "",
    `${homeEnv} git config --global --replace-all credential.https://github.com.helper ${shellQuote(
      helperCommand
    )}`,
    `${homeEnv} git config --global --replace-all credential.https://github.com.useHttpPath false`,
    `printf 'protocol=https\\nhost=github.com\\n\\n' | ${homeEnv} git credential fill | grep -q '^password='`,
  ]
}

function cleanGitHubUsername(username?: string | null) {
  const value = username?.trim()
  return value && /^[A-Za-z0-9-]{1,39}$/.test(value) ? value : "x-access-token"
}

function credentialHelperCommand(tokenPath: string) {
  return [
    "!f() {",
    '  [ "${1:-}" = "get" ] || exit 0;',
    "  protocol=; host=;",
    "  while IFS='=' read -r key value; do",
    '    [ -n "$key" ] || break;',
    '    case "$key" in protocol) protocol="$value" ;; host) host="$value" ;; esac;',
    "  done;",
    '  [ "$protocol" = "https" ] && [ "$host" = "github.com" ] || exit 0;',
    `  token_file=${shellQuote(tokenPath)};`,
    '  [ -f "$token_file" ] || exit 0;',
    "  printf 'username=x-access-token\\n';",
    '  printf "password=%s\\n" "$(cat "$token_file")";',
    "}; f",
  ].join(" ")
}

function credentialHelperScript(tokenPath: string) {
  return [
    "#!/bin/sh",
    '[ "${1:-}" = "get" ] || exit 0',
    "protocol=",
    "host=",
    "while IFS='=' read -r key value; do",
    '  [ -n "$key" ] || break',
    '  case "$key" in',
    '    protocol) protocol="$value" ;;',
    '    host) host="$value" ;;',
    "  esac",
    "done",
    '[ "$protocol" = "https" ] && [ "$host" = "github.com" ] || exit 0',
    `token_file=${shellQuote(tokenPath)}`,
    '[ -f "$token_file" ] || exit 0',
    "printf 'username=x-access-token\\n'",
    'printf "password=%s\\n" "$(cat "$token_file")"',
    "",
  ].join("\n")
}

function ghHostsFile({
  token,
  username,
}: {
  token: string
  username?: string | null
}) {
  return [
    "# Managed by Cloudcode. Removing this file signs gh out in this sandbox.",
    "github.com:",
    "    git_protocol: https",
    `    oauth_token: ${token}`,
    `    user: ${cleanGitHubUsername(username)}`,
    "",
  ].join("\n")
}

async function currentRepoGitHubRemote({
  paths,
  sandbox,
  signal,
}: {
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
  signal?: AbortSignal
}) {
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `test -d ${shellQuote(`${paths.repoPath}/.git`)}`,
      `git -C ${shellQuote(paths.repoPath)} remote get-url origin`,
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  ).catch((error) => {
    if (signal?.aborted) throw error
    return undefined
  })

  if (!result || result.exitCode !== 0) return null

  return gitHubRemoteUrl(result.stdout.trim())
}

async function cleanupSandboxGitHubAuth({
  installGlobal,
  paths,
  sandbox,
}: {
  installGlobal?: boolean
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
}) {
  const pathsForAuth = credentialPaths(paths)
  const globalGitHomes = uniquePaths([paths.home, paths.runtimeHome])
  const globalGhHostsPaths = uniquePaths([
    pathsForAuth.homeGhHostsPath,
    pathsForAuth.runtimeGhHostsPath,
  ])

  await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      installGlobal
        ? [
            ...globalGitHomes.flatMap(gitGlobalCleanupCommands),
            ...globalGhHostsPaths.map(
              (path) =>
                `if [ -f ${shellQuote(path)} ] && grep -q '^# Managed by Cloudcode\\.' ${shellQuote(
                  path
                )}; then rm -f ${shellQuote(path)}; fi`
            ),
          ].join("\n")
        : "",
      `rm -rf ${shellQuote(pathsForAuth.dir)}`,
    ].join("\n"),
    { env: terminalHomeEnv(paths), timeoutMs: 10_000 }
  ).catch(() => undefined)
}

export type SandboxGitHubAuthOptions = {
  githubToken?: string
  githubUserEmail?: string
  githubUserName?: string
  githubUsername?: string | null
  installGlobal?: boolean
  persistCredentials?: boolean
  paths: DaytonaSandboxPaths
  repoUrl?: string
  sandbox: Sandbox
  signal?: AbortSignal
}

export type SandboxGitHubAuthPlan = {
  auth: SandboxGitHubAuth
  commandEnv: Record<string, string>
  /**
   * Setup script without a `set -e` prefix so callers can embed it in a
   * larger combined command; run uploadSandboxGitHubAuthFiles first — the
   * script moves those staged files into place.
   */
  script: string
  uploads: { content: string; path: string }[]
}

/**
 * Computes everything the sandbox GitHub auth setup needs as staged file
 * uploads plus one shell script. Secrets travel via file uploads (never in
 * the command text); the script installs them, so a full auth refresh costs
 * one parallel upload round plus a single command instead of several
 * sequential sandbox roundtrips.
 */
export async function prepareSandboxGitHubAuthPlan({
  githubToken,
  githubUserEmail,
  githubUserName,
  githubUsername,
  installGlobal,
  persistCredentials,
  paths,
  repoUrl,
  sandbox,
  signal,
}: SandboxGitHubAuthOptions): Promise<SandboxGitHubAuthPlan | null> {
  const token = githubToken?.trim()

  if (!token || /[\r\n]/.test(token)) return null

  const remoteUrl =
    (repoUrl ? gitHubRemoteUrl(repoUrl) : null) ??
    (await currentRepoGitHubRemote({ paths, sandbox, signal }))

  const pathsForAuth = credentialPaths(paths)
  const cleanGitUserEmail = githubUserEmail?.trim()
  const cleanGitUserName = githubUserName?.trim()
  const helperScript = credentialHelperScript(pathsForAuth.tokenPath)
  const hostsFile = ghHostsFile({ token, username: githubUsername })
  const globalGitHomes = installGlobal
    ? uniquePaths([paths.home, paths.runtimeHome])
    : []
  const globalGhConfigDirs = installGlobal
    ? uniquePaths([
        pathsForAuth.homeGhConfigDir,
        pathsForAuth.runtimeGhConfigDir,
      ])
    : []
  const globalGhHostsPaths = installGlobal
    ? uniquePaths([
        pathsForAuth.homeGhHostsPath,
        pathsForAuth.runtimeGhHostsPath,
      ])
    : []
  const stageId = randomBytes(6).toString("hex")
  const tokenStagePath = `/tmp/cloudcode-gh-token-${stageId}`
  const hostsStagePath = `/tmp/cloudcode-gh-hosts-${stageId}`
  const helperCommand = credentialHelperCommand(pathsForAuth.tokenPath)
  const gitConfigEnv: Record<string, string> = {
    GIT_CONFIG_COUNT: "4",
    GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
    GIT_CONFIG_KEY_1: "credential.https://github.com.useHttpPath",
    GIT_CONFIG_KEY_2: "url.https://github.com/.insteadOf",
    GIT_CONFIG_KEY_3: "url.https://github.com/.insteadOf",
    GIT_CONFIG_VALUE_0: helperCommand,
    GIT_CONFIG_VALUE_1: "false",
    GIT_CONFIG_VALUE_2: "git@github.com:",
    GIT_CONFIG_VALUE_3: "ssh://git@github.com/",
  }

  const script = [
    ...uniquePaths([
      pathsForAuth.dir,
      pathsForAuth.ghConfigDir,
      ...globalGhConfigDirs,
    ]).map((path) => `mkdir -p ${shellQuote(path)}`),
    ...uniquePaths([
      pathsForAuth.dir,
      pathsForAuth.ghConfigDir,
      ...globalGhConfigDirs,
    ]).map((path) => `chmod 700 ${shellQuote(path)}`),
    `cat > ${shellQuote(pathsForAuth.helperPath)} <<'EOF'`,
    helperScript,
    "EOF",
    `chmod 700 ${shellQuote(pathsForAuth.helperPath)}`,
    `mv -f ${shellQuote(tokenStagePath)} ${shellQuote(pathsForAuth.tokenPath)}`,
    `chmod 600 ${shellQuote(pathsForAuth.tokenPath)}`,
    ...globalGhHostsPaths.map(
      (path) => `cp ${shellQuote(hostsStagePath)} ${shellQuote(path)}`
    ),
    `mv -f ${shellQuote(hostsStagePath)} ${shellQuote(pathsForAuth.ghHostsPath)}`,
    ...[pathsForAuth.ghHostsPath, ...globalGhHostsPaths].map(
      (path) => `chmod 600 ${shellQuote(path)}`
    ),
    ...(installGlobal
      ? globalGitHomes.flatMap((home) =>
          gitGlobalSetupCommands({
            cleanGitUserEmail,
            cleanGitUserName,
            helperCommand,
            home,
          })
        )
      : []),
  ]
    .filter(Boolean)
    .join("\n")

  return {
    auth: {
      cleanup: async () => {
        if (persistCredentials) return
        await cleanupSandboxGitHubAuth({
          installGlobal,
          paths,
          sandbox,
        })
      },
      env: {
        ...gitConfigEnv,
        GH_CONFIG_DIR: pathsForAuth.ghConfigDir,
        ...(cleanGitUserEmail
          ? {
              GIT_AUTHOR_EMAIL: cleanGitUserEmail,
              GIT_COMMITTER_EMAIL: cleanGitUserEmail,
            }
          : {}),
        ...(cleanGitUserName
          ? {
              GIT_AUTHOR_NAME: cleanGitUserName,
              GIT_COMMITTER_NAME: cleanGitUserName,
            }
          : {}),
      },
      remoteUrl,
      tokenPath: pathsForAuth.tokenPath,
    },
    commandEnv: terminalHomeEnv(paths),
    script,
    uploads: [
      { content: token, path: tokenStagePath },
      { content: hostsFile, path: hostsStagePath },
    ],
  }
}

export async function uploadSandboxGitHubAuthFiles(
  sandbox: Sandbox,
  plan: SandboxGitHubAuthPlan
) {
  await Promise.all(
    plan.uploads.map(({ content, path }) =>
      writeDaytonaTextFile(sandbox, path, content)
    )
  )
}

export async function setupSandboxGitHubAuth(
  options: SandboxGitHubAuthOptions
): Promise<SandboxGitHubAuth | null> {
  const plan = await prepareSandboxGitHubAuthPlan(options)
  if (!plan) return null

  await uploadSandboxGitHubAuthFiles(options.sandbox, plan)
  const setupResult = await runDaytonaCommand(
    options.sandbox,
    ["set -e", plan.script].join("\n"),
    {
      env: terminalHomeEnv(options.paths),
      signal: options.signal,
      timeoutMs: 15_000,
    }
  )
  if (setupResult.exitCode !== 0) {
    throw new Error(
      setupResult.stderr.trim() ||
        setupResult.stdout.trim() ||
        "Unable to configure GitHub credentials in the sandbox."
    )
  }

  return plan.auth
}

export async function configureSandboxGitHubRemote({
  auth,
  paths,
  sandbox,
  signal,
}: {
  auth: SandboxGitHubAuth | null
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
  signal?: AbortSignal
}) {
  if (!auth?.remoteUrl) return

  await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `test -d ${shellQuote(`${paths.repoPath}/.git`)}`,
      `current_remote=$(git -C ${shellQuote(
        paths.repoPath
      )} remote get-url origin 2>/dev/null || true)`,
      `if [ "$current_remote" != ${shellQuote(auth.remoteUrl)} ]; then`,
      `  git -C ${shellQuote(paths.repoPath)} remote set-url origin ${shellQuote(
        auth.remoteUrl
      )}`,
      "fi",
    ].join("\n"),
    { env: auth.env, signal, timeoutMs: 10_000 }
  ).catch(() => undefined)
}
