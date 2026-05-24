import type { Sandbox } from "@daytona/sdk"

import {
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "./daytona-sandbox"

export type SandboxGitHubAuth = {
  cleanup: () => Promise<void>
  env: Record<string, string>
  remoteUrl: string | null
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
    helperPath: `${dir}/git-credential-cloudcode-github`,
    tokenPath: `${dir}/token`,
  }
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
  ).catch(() => undefined)

  if (!result || result.exitCode !== 0) return null

  return gitHubRemoteUrl(result.stdout.trim())
}

export async function cleanupSandboxGitHubAuth({
  installGlobal,
  paths,
  sandbox,
}: {
  installGlobal?: boolean
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
}) {
  const pathsForAuth = credentialPaths(paths)

  await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      installGlobal
        ? [
            `case "$(git config --global --get credential.https://github.com.helper || true)" in *cloudcode-github*|*cloudcode*) git config --global --unset-all credential.https://github.com.helper || true ;; esac`,
            "git config --global --unset-all credential.https://github.com.useHttpPath || true",
            `git config --global --unset-all url.https://github.com/.insteadOf ${shellQuote(
              "^git@github\\.com:$"
            )} || true`,
            `git config --global --unset-all url.https://github.com/.insteadOf ${shellQuote(
              "^ssh://git@github\\.com/$"
            )} || true`,
            `if [ -f ${shellQuote(pathsForAuth.homeGhHostsPath)} ] && grep -q '^# Managed by Cloudcode\\.' ${shellQuote(
              pathsForAuth.homeGhHostsPath
            )}; then rm -f ${shellQuote(pathsForAuth.homeGhHostsPath)}; fi`,
          ].join("\n")
        : "",
      `rm -rf ${shellQuote(pathsForAuth.dir)}`,
    ].join("\n"),
    { timeoutMs: 10_000 }
  ).catch(() => undefined)
}

export async function setupSandboxGitHubAuth({
  githubToken,
  githubUserEmail,
  githubUserName,
  githubUsername,
  installGlobal,
  paths,
  repoUrl,
  sandbox,
  signal,
}: {
  githubToken?: string
  githubUserEmail?: string
  githubUserName?: string
  githubUsername?: string | null
  installGlobal?: boolean
  paths: DaytonaSandboxPaths
  repoUrl?: string
  sandbox: Sandbox
  signal?: AbortSignal
}): Promise<SandboxGitHubAuth | null> {
  const token = githubToken?.trim()

  if (!token || /[\r\n]/.test(token)) return null

  const remoteUrl =
    (repoUrl ? gitHubRemoteUrl(repoUrl) : null) ??
    (await currentRepoGitHubRemote({ paths, sandbox, signal }))

  if (!remoteUrl) return null

  const pathsForAuth = credentialPaths(paths)
  const cleanGitUserEmail = githubUserEmail?.trim()
  const cleanGitUserName = githubUserName?.trim()
  await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `mkdir -p ${shellQuote(pathsForAuth.dir)}`,
      `mkdir -p ${shellQuote(pathsForAuth.ghConfigDir)}`,
      installGlobal
        ? `mkdir -p ${shellQuote(pathsForAuth.homeGhConfigDir)}`
        : "",
      `chmod 700 ${shellQuote(pathsForAuth.dir)}`,
      `chmod 700 ${shellQuote(pathsForAuth.ghConfigDir)}`,
      installGlobal
        ? `chmod 700 ${shellQuote(pathsForAuth.homeGhConfigDir)}`
        : "",
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  )
  const hostsFile = ghHostsFile({ token, username: githubUsername })
  await Promise.all([
    writeDaytonaTextFile(sandbox, pathsForAuth.tokenPath, token),
    writeDaytonaTextFile(sandbox, pathsForAuth.ghHostsPath, hostsFile),
    ...(installGlobal
      ? [writeDaytonaTextFile(sandbox, pathsForAuth.homeGhHostsPath, hostsFile)]
      : []),
    writeDaytonaTextFile(
      sandbox,
      pathsForAuth.helperPath,
      credentialHelperScript(pathsForAuth.tokenPath)
    ),
  ])
  const helperCommand = credentialHelperCommand(pathsForAuth.tokenPath)
  const gitConfigEnv: Record<string, string> = installGlobal
    ? {}
    : {
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
  await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `chmod 600 ${shellQuote(pathsForAuth.tokenPath)}`,
      `chmod 600 ${shellQuote(pathsForAuth.ghHostsPath)}`,
      installGlobal
        ? `chmod 600 ${shellQuote(pathsForAuth.homeGhHostsPath)}`
        : "",
      `chmod 700 ${shellQuote(pathsForAuth.helperPath)}`,
      ...(installGlobal
        ? [
            `git config --global --unset-all url.https://github.com/.insteadOf ${shellQuote(
              "^git@github\\.com:$"
            )} || true`,
            `git config --global --unset-all url.https://github.com/.insteadOf ${shellQuote(
              "^ssh://git@github\\.com/$"
            )} || true`,
            "git config --global --add url.https://github.com/.insteadOf git@github.com:",
            "git config --global --add url.https://github.com/.insteadOf ssh://git@github.com/",
            cleanGitUserName
              ? `git config --global user.name ${shellQuote(cleanGitUserName)}`
              : "",
            cleanGitUserEmail
              ? `git config --global user.email ${shellQuote(cleanGitUserEmail)}`
              : "",
            `git config --global --replace-all credential.https://github.com.helper ${shellQuote(
              helperCommand
            )}`,
            "git config --global --replace-all credential.https://github.com.useHttpPath false",
          ]
        : []),
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  )

  return {
    cleanup: async () => {
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
  }
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
      `git -C ${shellQuote(paths.repoPath)} remote set-url origin ${shellQuote(
        auth.remoteUrl
      )}`,
    ].join("\n"),
    { env: auth.env, signal, timeoutMs: 10_000 }
  ).catch(() => undefined)
}
