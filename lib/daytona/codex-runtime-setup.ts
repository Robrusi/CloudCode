import { createHash } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import { runCloudcodeYamlSetup } from "@/lib/cloudcode/yaml-setup"
import { compactLine } from "@/lib/shared/compact-line"
import type { RunCodexInSandboxInput } from "@/lib/daytona/codex-agent-types"
import {
  linkSandboxPathToolsCommand,
  presetProfileSnippet,
  runtimeShellProfileSnippet,
  sandboxInstallEnv,
  writeBase64FileCommand,
} from "@/lib/daytona/codex-runtime"
import {
  installDaytonaTarWrapper,
  readDaytonaTextFile,
  repoCommandEnv,
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"
import type { CodexRunLog as RunCodexLog } from "@/lib/codex/run-log"
import {
  CLOUDCODE_LEGACY_PRESET_ENV_PATH,
  withoutCloudcodeEnvLocal,
  writeCloudcodeEnvLocal,
  type SandboxEnvTarget,
} from "@/lib/sandbox/env"
import type { SandboxGitHubAuth } from "@/lib/sandbox/github-auth"

const RUNTIME_BOOTSTRAP_REFRESHED = "__CLOUDCODE_RUNTIME_BOOTSTRAP_REFRESHED__"
const RUNTIME_BOOTSTRAP_VERSION = "1"

function createSandboxTarget(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
): SandboxEnvTarget {
  return {
    readTextFile: (path) => readDaytonaTextFile(sandbox, path),
    runCommand: (command, options) =>
      runDaytonaCommand(sandbox, command, {
        cwd: paths.home,
        env: repoCommandEnv(paths),
        signal,
        timeoutMs: options?.timeoutMs,
      }),
    writeTextFile: (path, content) =>
      writeDaytonaTextFile(sandbox, path, content),
  }
}

export async function emitRunLog(
  input: RunCodexInSandboxInput,
  log: RunCodexLog
) {
  await input.onLog?.(log)
}

export async function collectRunDiffAndStatus({
  exitCode,
  gitAuth,
  input,
  paths,
  sandbox,
}: {
  exitCode: number
  gitAuth?: SandboxGitHubAuth | null
  input: RunCodexInSandboxInput
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
}) {
  const target = createSandboxTarget(sandbox, paths, input.signal)
  return await withoutCloudcodeEnvLocal(
    target,
    {
      legacyPresetEnvPath: CLOUDCODE_LEGACY_PRESET_ENV_PATH,
      presetEnvPath: paths.presetEnvPath,
      repoPath: paths.repoPath,
    },
    async () => {
      const diff = (
        await runDaytonaCommand(
          sandbox,
          [
            "set -e",
            `base_ref=$(cat ${shellQuote(paths.baseRefPath)} 2>/dev/null || true)`,
            'if [ -z "$base_ref" ]; then',
            `  base_ref=$(git -C ${shellQuote(paths.repoPath)} rev-parse --verify HEAD 2>/dev/null || git -C ${shellQuote(paths.repoPath)} hash-object -t tree /dev/null)`,
            "fi",
            `git -C ${shellQuote(paths.repoPath)} add -N . >/dev/null 2>&1 || true`,
            `git -C ${shellQuote(paths.repoPath)} diff --binary "$base_ref"`,
          ].join("\n"),
          {
            env: repoCommandEnv(paths, gitAuth?.env),
            signal: input.signal,
            timeoutMs: 60_000,
          }
        )
      ).stdout
      const status = await runDaytonaCommand(
        sandbox,
        `git -C ${shellQuote(paths.repoPath)} status --short --branch`,
        {
          env: repoCommandEnv(paths, gitAuth?.env),
          signal: input.signal,
          timeoutMs: 60_000,
        }
      ).then((result) => result.stdout)
      await emitRunLog(input, {
        kind: "result",
        message:
          exitCode === 0
            ? "Codex run completed"
            : `Codex exited with code ${exitCode}`,
      })

      return { diff, status }
    }
  )
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export async function prepareSandboxRuntime(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths
) {
  const target = createSandboxTarget(sandbox, paths, input.signal)
  const runtimeProfile = runtimeShellProfileSnippet(paths, input.sandboxPreset)
  const presetProfile = presetProfileSnippet(paths, input.sandboxPreset)
  const markerPath = `${paths.codexHome}/runtime-bootstrap.sha256`
  const bootstrapHash = sha256(
    [
      RUNTIME_BOOTSTRAP_VERSION,
      paths.home,
      paths.runtimeHome,
      paths.codexHome,
      paths.repoPath,
      paths.presetEnvPath,
      runtimeProfile,
      presetProfile,
    ].join("\0")
  )

  const bootstrapResult = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `marker_path=${shellQuote(markerPath)}`,
      `bootstrap_hash=${shellQuote(bootstrapHash)}`,
      `if [ -f "$marker_path" ] && grep -qxF -- "$bootstrap_hash" "$marker_path"; then exit 0; fi`,
      `mkdir -p ${shellQuote(paths.home)} ${shellQuote(paths.runtimeHome)} ${shellQuote(paths.codexHome)}`,
      `chmod 700 ${shellQuote(paths.runtimeHome)} ${shellQuote(paths.codexHome)}`,
      'if [ -x /bin/bash ] && command -v usermod >/dev/null 2>&1; then usermod -s /bin/bash "$(id -un)" 2>/dev/null || true; fi',
      'if [ -x /bin/bash ] && command -v chsh >/dev/null 2>&1; then chsh -s /bin/bash "$(id -un)" 2>/dev/null || true; fi',
      "[ -f /etc/profile.d/rvm.sh ] && mv /etc/profile.d/rvm.sh /etc/profile.d/rvm.sh.cloudcode-disabled 2>/dev/null || true",
      linkSandboxPathToolsCommand(paths),
      writeBase64FileCommand(paths.presetEnvPath, presetProfile),
      ...[".bash_profile", ".bash_login", ".profile", ".bashrc"].map((file) =>
        writeBase64FileCommand(`${paths.runtimeHome}/${file}`, runtimeProfile)
      ),
      `chmod 600 ${shellQuote(paths.presetEnvPath)} ${shellQuote(
        `${paths.runtimeHome}/.bash_profile`
      )} ${shellQuote(`${paths.runtimeHome}/.bash_login`)} ${shellQuote(
        `${paths.runtimeHome}/.profile`
      )} ${shellQuote(`${paths.runtimeHome}/.bashrc`)}`,
      `profile_line=${shellQuote(`. ${paths.cloudcodeProfilePath}`)}`,
      `for file in ${shellQuote(`${paths.home}/.bashrc`)} ${shellQuote(`${paths.home}/.profile`)}; do`,
      '  [ -f "$file" ] || continue',
      "  tmp=$(mktemp)",
      '  grep -vxF "$profile_line" "$file" > "$tmp" || true',
      '  cat "$tmp" > "$file"',
      '  rm -f "$tmp"',
      "done",
      `rm -f ${shellQuote(paths.cloudcodeProfilePath)}`,
      `printf '%s\\n' ${shellQuote(RUNTIME_BOOTSTRAP_REFRESHED)}`,
    ].join("\n"),
    { cwd: paths.home, signal: input.signal, timeoutMs: 10_000 }
  )
  if (bootstrapResult.exitCode !== 0) {
    throw new Error(
      compactLine(bootstrapResult.stderr || bootstrapResult.stdout) ||
        "Unable to prepare sandbox runtime."
    )
  }
  if (bootstrapResult.stdout.includes(RUNTIME_BOOTSTRAP_REFRESHED)) {
    await installDaytonaTarWrapper(sandbox, paths)
    await writeDaytonaTextFile(sandbox, markerPath, `${bootstrapHash}\n`)
  }

  if (input.sandboxPreset?.secrets.length) {
    await emitRunLog(input, {
      kind: "setup",
      message: `Writing ${input.sandboxPreset.secrets.length} preset secret${input.sandboxPreset.secrets.length === 1 ? "" : "s"} to .env.local`,
    })
    await writeCloudcodeEnvLocal(
      target,
      paths.repoPath,
      input.sandboxPreset.secrets
    )
  } else {
    await writeCloudcodeEnvLocal(target, paths.repoPath, [])
  }
}

export async function cleanupRunFiles(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  await runDaytonaCommand(
    sandbox,
    `rm -f ${shellQuote(paths.previousDiffPath)} ${shellQuote(paths.lastMessagePath)}`,
    {
      signal,
      timeoutMs: 10_000,
    }
  ).catch(() => undefined)
}

function isAutoEnvironmentRun(input: RunCodexInSandboxInput) {
  return input.sandboxPreset?.mode === "auto"
}

async function readCloudcodeYamlForLiveSandbox(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths
) {
  if (!isAutoEnvironmentRun(input)) return undefined

  const repoCloudcodeYaml = await readDaytonaTextFile(
    sandbox,
    `${paths.repoPath}/cloudcode.yaml`
  ).catch(() => "")
  if (repoCloudcodeYaml.trim()) {
    return {
      source: "repo" as const,
      yaml: repoCloudcodeYaml,
    }
  }

  const convexCloudcodeYaml = input.sandboxPreset?.cloudcodeYaml?.trim()
  if (!convexCloudcodeYaml) return undefined

  return {
    source: "convex" as const,
    yaml: convexCloudcodeYaml,
  }
}

export async function runLiveCloudcodeYamlSetup(
  sandbox: Sandbox,
  input: RunCodexInSandboxInput,
  paths: DaytonaSandboxPaths,
  gitAuth?: SandboxGitHubAuth | null
) {
  const selected = await readCloudcodeYamlForLiveSandbox(sandbox, input, paths)
  if (!selected) return

  const result = await runCloudcodeYamlSetup({
    cloudcodeYaml: selected.yaml,
    emit: (log) => emitRunLog(input, log),
    env: sandboxInstallEnv(paths, {
      extraEnv: gitAuth?.env,
      overrides: {
        CLOUDCODE_REPO: paths.repoPath,
        MISE_YES: "1",
      },
      secrets: input.sandboxPreset?.secrets,
    }),
    markerPath: `${paths.codexHome}/cloudcode-yaml-setup.sha256`,
    paths,
    sandbox,
    signal: input.signal,
    writeCloudcodeYaml: selected.source === "convex",
  })

  if (result.ran) {
    await emitRunLog(input, {
      kind: "setup",
      message: "cloudcode.yaml environment setup completed",
    })
  }
}
