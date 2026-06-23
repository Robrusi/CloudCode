import { createHash } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import { runCodexViaAppServer } from "@/lib/daytona/codex-app-server-run"

import { desiredCodexCliVersion } from "@/lib/codex/cli-version"
import { CODEX_APP_SERVER_DAEMON_VERSION } from "@/lib/codex/app-server-daemon-script"
import { defaultBranchName, parseBranchMode } from "@/lib/codex/branch-names"
import {
  isCodexLauncherReady,
  updateCodexCli,
} from "@/lib/daytona/codex-cli-setup"
import {
  daytonaDesktopAgentContext,
  daytonaDesktopToolVersion,
  installDaytonaDesktopTools,
  stopDaytonaDesktopAgentRecording,
  type DaytonaDesktopRecordingArtifact,
} from "@/lib/daytona/desktop"
import {
  cloudcodeContextAgentContext,
  cloudcodeContextAgentInstructions,
  cloudcodeContextCodexConfig,
  cloudcodeContextToolVersion,
  installCloudcodeContextTools,
  writeCloudcodeContextState,
} from "@/lib/daytona/context"
import { buildImageAttachmentPromptBlock } from "@/lib/chat/attachments"
import { compactLine } from "@/lib/shared/compact-line"
import {
  createDaytonaSandbox,
  defaultDaytonaSnapshot,
  defaultDaytonaSandboxResources,
  ensureDaytonaSandboxStarted,
  getDaytonaSandbox,
  resolveDaytonaPaths,
  runDaytonaCommand,
  shellQuote,
  startDaytonaActivityHeartbeat,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"
import {
  cleanupRunFiles,
  collectRunDiffAndStatus,
  emitRunLog as emitLog,
  prepareSandboxRuntime,
  runLiveCloudcodeYamlSetup,
} from "@/lib/daytona/codex-runtime-setup"
import {
  cloneRepo,
  prepareExistingRepoForFreshRun,
  readRepoState,
  trustRepoMiseConfig,
  writeBaseRef,
} from "@/lib/daytona/codex-repo"
import { materializeSandboxImageAttachments } from "@/lib/daytona/image-attachments"
import {
  parseCodexReasoningEffortOrThrow,
  parseCodexSpeedOrThrow,
} from "@/lib/codex/run-options"
import type {
  CodexRunLog as RunCodexLog,
  CodexRunLogKind as RunCodexLogKind,
} from "@/lib/codex/run-log"
import {
  parseCodexModel,
  parseGitRef,
  parseOpaqueId,
  parseRequiredGitRepoUrl,
} from "@/lib/codex/run-input"
import { cloudcodeYamlAgentContext } from "@/lib/cloudcode/yaml"
import {
  configureSandboxGitHubRemote,
  setupSandboxGitHubAuth,
  type SandboxGitHubAuth,
} from "@/lib/sandbox/github-auth"
import {
  presetSecretEnv,
  userMcpCodexConfig,
} from "@/lib/daytona/codex-runtime"
import {
  runPathInstallScript,
  runPresetInstallScript,
} from "@/lib/daytona/codex-install-scripts"
import type {
  RunCodexInSandboxInput,
  RunCodexInSandboxResult,
} from "@/lib/daytona/codex-agent-types"

export type { RunCodexLog, RunCodexLogKind }

const HOT_CONTINUATION_VERSION = "1"
const HOT_CONTINUATION_STATUS_MARKER = "__cloudcode_hot_continuation__"

function withUpdatedAuthJson(
  result: Omit<RunCodexInSandboxResult, "updatedAuthJson">,
  updatedAuthJson: string
): RunCodexInSandboxResult {
  Object.defineProperty(result, "updatedAuthJson", {
    configurable: true,
    enumerable: false,
    value: updatedAuthJson,
    writable: false,
  })

  return result as RunCodexInSandboxResult
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== "object") return value ?? null

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => {
        if (left < right) return -1
        if (left > right) return 1
        return 0
      })
      .map(([key, entryValue]) => [key, stableValue(entryValue)])
  )
}

function hotContinuationMarkerPath(paths: DaytonaSandboxPaths) {
  return `${paths.codexHome}/hot-continuation.sha256`
}

function hotContinuationFingerprint({
  baseBranch,
  contextConfig,
  input,
  mcpConfig,
  paths,
  repoUrl,
  requestedBranchName,
  useBaseBranch,
}: {
  baseBranch?: string
  contextConfig: string
  input: RunCodexInSandboxInput
  mcpConfig: string
  paths: DaytonaSandboxPaths
  repoUrl: string
  requestedBranchName?: string
  useBaseBranch: boolean
}) {
  return sha256(
    [
      HOT_CONTINUATION_VERSION,
      repoUrl,
      stableJson({
        baseBranch,
        branchMode: input.branchMode ?? "auto",
        contextConfig,
        codexCliVersion: desiredCodexCliVersion(),
        codexDaemonVersion: CODEX_APP_SERVER_DAEMON_VERSION,
        contextToolVersion: cloudcodeContextToolVersion(),
        desktopToolVersion: daytonaDesktopToolVersion(),
        mcpConfig,
        paths: {
          codexHome: paths.codexHome,
          codexLauncherPath: paths.codexLauncherPath,
          home: paths.home,
          presetEnvPath: paths.presetEnvPath,
          repoPath: paths.repoPath,
          runtimeHome: paths.runtimeHome,
        },
        requestedBranchName,
        sandboxPreset: input.sandboxPreset ?? null,
        useBaseBranch,
      }),
    ].join("\0")
  )
}

function hotContinuationHashHelpers() {
  return [
    "hash_file() {",
    "  if command -v sha256sum >/dev/null 2>&1; then sha256sum \"$1\" | awk '{print $1}'; return; fi",
    "  if command -v shasum >/dev/null 2>&1; then shasum -a 256 \"$1\" | awk '{print $1}'; return; fi",
    "  cksum \"$1\" | awk '{print $1}'",
    "}",
    "hash_stream() {",
    "  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'; return; fi",
    "  if command -v shasum >/dev/null 2>&1; then shasum -a 256 | awk '{print $1}'; return; fi",
    "  cksum | awk '{print $1}'",
    "}",
    "repo_cloudcode_hash() {",
    '  if [ -f "$repo_path/cloudcode.yaml" ]; then hash_file "$repo_path/cloudcode.yaml"; else printf \'missing\'; fi',
    "}",
    "repo_mise_hash() {",
    "  {",
    "    for file in .mise.toml mise.toml .config/mise.toml .config/mise/config.toml; do",
    '      [ -f "$repo_path/$file" ] || continue',
    "      printf '%s\\n' \"$file\"",
    '      hash_file "$repo_path/$file"',
    "    done",
    "  } | hash_stream",
    "}",
  ].join("\n")
}

async function readHotContinuationState({
  contextEnabled,
  enabled,
  expectedFingerprint,
  expectedRemoteUrl,
  paths,
  sandbox,
  signal,
}: {
  contextEnabled: boolean
  enabled: boolean
  expectedFingerprint: string
  expectedRemoteUrl?: string | null
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
  signal?: AbortSignal
}) {
  if (!enabled) return { ready: false as const }

  const result = await runDaytonaCommand(
    sandbox,
    [
      "set +e",
      `repo_path=${shellQuote(paths.repoPath)}`,
      `marker_path=${shellQuote(hotContinuationMarkerPath(paths))}`,
      `expected_fingerprint=${shellQuote(expectedFingerprint)}`,
      `expected_remote=${shellQuote(expectedRemoteUrl ?? "")}`,
      `context_enabled=${contextEnabled ? "1" : "0"}`,
      hotContinuationHashHelpers(),
      "miss() {",
      `  printf '${HOT_CONTINUATION_STATUS_MARKER} miss %s\\n' "$1"`,
      "  exit 0",
      "}",
      '[ -f "$marker_path" ] || miss marker',
      '[ -d "$repo_path/.git" ] || miss repo',
      `[ -x ${shellQuote(paths.codexLauncherPath)} ] || miss launcher`,
      `[ -s ${shellQuote(paths.baseRefPath)} ] || miss base-ref`,
      `[ -s ${shellQuote(paths.presetEnvPath)} ] || miss preset-env`,
      `[ -s ${shellQuote(`${paths.codexHome}/AGENTS.md`)} ] || miss agents`,
      `[ -s ${shellQuote(`${paths.codexHome}/config.toml`)} ] || miss config`,
      `[ -x ${shellQuote(`${paths.codexHome}/desktop/cloudcode-desktop-mcp.mjs`)} ] || miss desktop-tool`,
      `[ -s ${shellQuote(`${paths.codexHome}/desktop/tool-version`)} ] || miss desktop-marker`,
      `[ "$context_enabled" != "1" ] || [ -x ${shellQuote(`${paths.codexHome}/context/cloudcode-context-mcp.mjs`)} ] || miss context-tool`,
      `[ "$context_enabled" != "1" ] || [ -s ${shellQuote(`${paths.codexHome}/context/tool-version`)} ] || miss context-marker`,
      "yaml_hash=$(repo_cloudcode_hash)",
      "mise_hash=$(repo_mise_hash)",
      'expected_line="$expected_fingerprint $yaml_hash $mise_hash"',
      'grep -qxF -- "$expected_line" "$marker_path" 2>/dev/null || miss fingerprint',
      'branch=$(git -C "$repo_path" rev-parse --abbrev-ref HEAD 2>/dev/null || true)',
      '[ -n "$branch" ] && [ "$branch" != HEAD ] || miss branch',
      'remote=$(git -C "$repo_path" remote get-url origin 2>/dev/null || true)',
      '[ -z "$expected_remote" ] || [ "$remote" = "$expected_remote" ] || miss remote',
      `printf '${HOT_CONTINUATION_STATUS_MARKER} ready %s\\n' "$branch"`,
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  ).catch(() => undefined)

  const line = result?.stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(HOT_CONTINUATION_STATUS_MARKER))
  const [, status, branchName] = line?.split(/\s+/, 3) ?? []
  if (status === "ready" && branchName) {
    return { branchName, ready: true as const }
  }
  return { ready: false as const }
}

async function writeHotContinuationMarker({
  fingerprint,
  paths,
  sandbox,
  signal,
}: {
  fingerprint: string
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
  signal?: AbortSignal
}) {
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `repo_path=${shellQuote(paths.repoPath)}`,
      `marker_path=${shellQuote(hotContinuationMarkerPath(paths))}`,
      `fingerprint=${shellQuote(fingerprint)}`,
      hotContinuationHashHelpers(),
      "yaml_hash=$(repo_cloudcode_hash)",
      "mise_hash=$(repo_mise_hash)",
      `mkdir -p ${shellQuote(paths.codexHome)}`,
      'printf \'%s %s %s\\n\' "$fingerprint" "$yaml_hash" "$mise_hash" > "$marker_path"',
      'chmod 600 "$marker_path"',
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      compactLine(result.stderr || result.stdout) ||
        "Unable to write hot continuation marker."
    )
  }
}

function sandboxIsUnderResourced(sandbox: Sandbox) {
  const desired = defaultDaytonaSandboxResources()
  return (
    sandbox.cpu < desired.cpu ||
    sandbox.memory < desired.memory ||
    sandbox.disk < desired.disk
  )
}

async function connectOrCreateSandbox(input: RunCodexInSandboxInput) {
  const createNewSandbox = () =>
    createDaytonaSandbox({
      envVars: presetSecretEnv(input.sandboxPreset?.secrets),
      labels: {
        "cloudcode-run-id": input.runId,
        "cloudcode-thread-id": input.threadId,
        "cloudcode-user-id": input.userId,
      },
      name: input.sandboxPreset?.name,
      snapshot: input.sandboxPreset?.daytonaSnapshot,
    })
  const desiredSnapshot =
    input.sandboxPreset?.daytonaSnapshot?.trim() || defaultDaytonaSnapshot()

  if (input.sandboxId) {
    try {
      const sandbox = await ensureDaytonaSandboxStarted(
        await getDaytonaSandbox(input.sandboxId)
      )
      const snapshotMismatch =
        desiredSnapshot && sandbox.snapshot !== desiredSnapshot
      const resourceMismatch =
        !desiredSnapshot && sandboxIsUnderResourced(sandbox)
      if (snapshotMismatch || resourceMismatch) {
        await sandbox
          .delete(120)
          .catch(() => sandbox.stop(120, true).catch(() => undefined))
        return {
          createdSandbox: true,
          recoveredSandbox: true,
          sandbox: await createNewSandbox(),
        }
      }

      return {
        createdSandbox: false,
        recoveredSandbox: false,
        sandbox,
      }
    } catch {
      // The DB can outlive an auto-deleted sandbox. Continue in a fresh one.
    }
  }

  return {
    createdSandbox: true,
    recoveredSandbox: Boolean(input.sandboxId),
    sandbox: await createNewSandbox(),
  }
}

export async function runCodexInSandbox(input: RunCodexInSandboxInput) {
  const model = parseCodexModel(input.model)
  const reasoningEffort = parseCodexReasoningEffortOrThrow(
    input.reasoningEffort
  )
  const repoUrl = parseRequiredGitRepoUrl(input.repoUrl)
  const baseBranch = parseGitRef(input.baseBranch, "baseBranch")
  const useBaseBranch = parseBranchMode(input.branchMode) === "base"
  const requestedBranchName = useBaseBranch
    ? undefined
    : parseGitRef(input.branchName, "branchName")
  let branchName = requestedBranchName ?? defaultBranchName()
  const githubToken = input.githubToken?.trim()
  const speed = parseCodexSpeedOrThrow(input.speed)
  const existingCodexThreadId = parseOpaqueId(
    input.codexThreadId,
    "codexThreadId"
  )

  const [, sandboxConnection] = await Promise.all([
    emitLog(input, {
      kind: "setup",
      message: input.sandboxId
        ? "Connecting to Daytona sandbox"
        : input.sandboxPreset?.daytonaSnapshot
          ? "Creating Daytona sandbox from preset snapshot"
          : "Creating Daytona sandbox",
    }),
    connectOrCreateSandbox(input),
  ])
  const { createdSandbox, recoveredSandbox, sandbox } = sandboxConnection
  await emitLog(input, {
    detail: sandbox.id,
    kind: "setup",
    message: recoveredSandbox
      ? "Recovered with a fresh Daytona sandbox"
      : "Daytona sandbox ready",
  })
  const paths = await resolveDaytonaPaths(sandbox)
  let gitAuth: SandboxGitHubAuth | null = null
  let stopDaytonaActivityHeartbeat: (() => void) | undefined
  let checkedDesktopAgentRecording = false
  let emittedDesktopRecordingStopError = false
  let desktopRecording: DaytonaDesktopRecordingArtifact | undefined

  async function stopDesktopAgentRecording() {
    if (checkedDesktopAgentRecording) return

    try {
      const recording = await stopDaytonaDesktopAgentRecording(
        sandbox,
        paths,
        input.signal
      )
      checkedDesktopAgentRecording = true
      if (!recording) return
      desktopRecording = recording

      await emitLog(input, {
        kind: "setup",
        message: "Daytona desktop recording ready",
      })
    } catch (error) {
      if (emittedDesktopRecordingStopError) return
      emittedDesktopRecordingStopError = true
      await emitLog(input, {
        kind: "stderr",
        message:
          error instanceof Error
            ? compactLine(error.message)
            : "Unable to stop Daytona desktop recording.",
      })
    }
  }

  try {
    stopDaytonaActivityHeartbeat = startDaytonaActivityHeartbeat(sandbox)
    gitAuth = await setupSandboxGitHubAuth({
      githubToken,
      githubUserEmail: input.githubUserEmail,
      githubUserName: input.githubUserName,
      githubUsername: input.githubUsername,
      persistCredentials: true,
      paths,
      repoUrl,
      sandbox,
      signal: input.signal,
    })

    await emitLog(input, {
      detail: sandbox.snapshot,
      kind: "setup",
      message: `Sandbox resources: ${sandbox.cpu} CPU, ${sandbox.memory} GB RAM`,
    })

    const codexThreadIdToResume = existingCodexThreadId
    const sandboxImageAttachments = await materializeSandboxImageAttachments({
      attachments: input.imageAttachments ?? [],
      onAttachmentReady: (attachment) =>
        emitLog(input, {
          detail: attachment.sandboxPath,
          kind: "setup",
          message: "Image attachment ready",
        }),
      paths,
      runId: input.runId,
      sandbox,
      signal: input.signal,
    })
    const taskPrompt = input.prompt
    const sharedNotesEnabled = Boolean(
      input.convexUrl && input.notesAccessToken && input.runId && input.threadId
    )
    const contextBlocks = [
      cloudcodeYamlAgentContext(input.sandboxPreset?.cloudcodeYaml),
      sharedNotesEnabled ? cloudcodeContextAgentContext() : undefined,
      daytonaDesktopAgentContext(),
      buildImageAttachmentPromptBlock(sandboxImageAttachments),
    ].filter((value): value is string => Boolean(value))
    const promptForTask = (task: string) =>
      contextBlocks.length
        ? [...contextBlocks, "Current user request:", task].join("\n\n")
        : task
    const prompt = promptForTask(taskPrompt)
    const contextConfig = cloudcodeContextCodexConfig({
      convexUrl: input.convexUrl,
      notesAccessToken: input.notesAccessToken,
      paths,
      runId: input.runId,
      threadId: input.threadId,
    })
    const mcpConfig = [contextConfig, userMcpCodexConfig(input.mcpServers)]
      .filter(Boolean)
      .join("\n")

    const finishRun = async () => {
      const appServerResult = await runCodexViaAppServer({
        codexThreadIdToResume,
        gitAuth,
        input,
        model,
        paths,
        prompt,
        reasoningEffort,
        sandbox,
        speed,
      })
      await stopDesktopAgentRecording()

      await Promise.all([
        appServerResult.exitCode === 0
          ? Promise.resolve()
          : emitLog(input, {
              detail: String(appServerResult.exitCode),
              kind: "stderr",
              message: `Codex exited with code ${appServerResult.exitCode}`,
            }),
        cleanupRunFiles(sandbox, paths, input.signal),
      ])
      const { updatedAuthJson } = appServerResult

      const { diff, status } = await collectRunDiffAndStatus({
        exitCode: appServerResult.exitCode,
        gitAuth,
        input,
        paths,
        sandbox,
      })

      return withUpdatedAuthJson(
        {
          branchName,
          codexThreadId: appServerResult.codexThreadId,
          desktopRecording,
          diff,
          exitCode: appServerResult.exitCode,
          lastMessage: appServerResult.lastMessage,
          lastMessageAuthoritative: true,
          repoUrl,
          sandboxId: sandbox.id,
          stderr: appServerResult.stderr,
          status,
          stdout: appServerResult.stdout,
          recoveredSandbox,
        },
        updatedAuthJson
      )
    }

    const hotFingerprint = hotContinuationFingerprint({
      baseBranch,
      contextConfig,
      input,
      mcpConfig,
      paths,
      repoUrl,
      requestedBranchName,
      useBaseBranch,
    })
    const hotContinuation = await readHotContinuationState({
      contextEnabled: Boolean(contextConfig),
      enabled: Boolean(
        input.sandboxId &&
        existingCodexThreadId &&
        !createdSandbox &&
        !recoveredSandbox
      ),
      expectedFingerprint: hotFingerprint,
      expectedRemoteUrl: gitAuth?.remoteUrl,
      paths,
      sandbox,
      signal: input.signal,
    })
    if (hotContinuation.ready) {
      if (contextConfig) {
        const contextStateReady = await writeCloudcodeContextState(
          sandbox,
          paths,
          {
            convexUrl: input.convexUrl,
            notesAccessToken: input.notesAccessToken,
            runId: input.runId,
            threadId: input.threadId,
          }
        )
          .then(() => true)
          .catch(() => false)
        if (!contextStateReady) {
          await emitLog(input, {
            kind: "setup",
            message: "Hot sandbox continuation skipped",
          })
        } else {
          branchName = hotContinuation.branchName
          await emitLog(input, {
            kind: "setup",
            message: "Using hot sandbox continuation",
          })
          return await finishRun()
        }
      } else {
        branchName = hotContinuation.branchName
        await emitLog(input, {
          kind: "setup",
          message: "Using hot sandbox continuation",
        })
        return await finishRun()
      }
    }

    const needsCodexSetup =
      recoveredSandbox ||
      !(await isCodexLauncherReady(sandbox, paths, input.signal))

    if (needsCodexSetup) {
      await updateCodexCli(sandbox, input, paths)
    }

    const repoState = await readRepoState(sandbox, paths)
    const repoAlreadyExists = repoState.exists
    const configureGitHubRemoteIfNeeded = async () => {
      if (gitAuth?.remoteUrl && repoState.remoteUrl === gitAuth.remoteUrl) {
        return
      }
      await configureSandboxGitHubRemote({
        auth: gitAuth,
        paths,
        sandbox,
        signal: input.signal,
      })
    }
    let preparedFreshRepo = false
    if (!repoAlreadyExists) {
      branchName = await cloneRepo({
        baseBranch,
        branchName,
        gitAuth,
        githubToken,
        input,
        requestedBranchName,
        repoUrl,
        sandbox,
        paths,
        useBaseBranch,
      })
      await configureSandboxGitHubRemote({
        auth: gitAuth,
        paths,
        sandbox,
        signal: input.signal,
      })
      await trustRepoMiseConfig(sandbox, input, paths)
      await writeBaseRef(sandbox, paths)
      preparedFreshRepo = true
    } else {
      await configureGitHubRemoteIfNeeded()
      await trustRepoMiseConfig(sandbox, input, paths)
      const shouldPrepareFreshRepo = createdSandbox
      if (shouldPrepareFreshRepo) {
        branchName = await prepareExistingRepoForFreshRun({
          baseBranch,
          branchName,
          gitAuth,
          input,
          paths,
          requestedBranchName,
          sandbox,
          useBaseBranch,
        })
        await writeBaseRef(sandbox, paths)
        preparedFreshRepo = true
      }
    }
    if (repoAlreadyExists && !preparedFreshRepo) {
      // No branch was created this run, so report the branch HEAD is actually on
      // rather than the generated fallback. Matters most for "base" mode, where
      // the work stays on the base branch across continuations.
      if (repoState.branch) branchName = repoState.branch
    }
    if (preparedFreshRepo && input.previousDiff?.trim()) {
      await Promise.all([
        emitLog(input, {
          kind: "command",
          message: "git apply previous changes",
        }),
        writeDaytonaTextFile(
          sandbox,
          paths.previousDiffPath,
          input.previousDiff
        ),
      ])
      const applyResult = await runDaytonaCommand(
        sandbox,
        `git -C ${shellQuote(
          paths.repoPath
        )} apply --whitespace=nowarn ${shellQuote(paths.previousDiffPath)}`,
        { signal: input.signal, timeoutMs: 60_000 }
      )
      if (applyResult.exitCode !== 0) {
        await emitLog(input, {
          kind: "stderr",
          message:
            compactLine(applyResult.stderr || applyResult.stdout) ||
            "Unable to apply previous diff.",
        })
      }
    }

    await prepareSandboxRuntime(sandbox, input, paths)
      .then(() => runLiveCloudcodeYamlSetup(sandbox, input, paths, gitAuth))
      .then(() =>
        contextConfig
          ? installCloudcodeContextTools(sandbox, paths, input.signal)
          : undefined
      )
      .then(() =>
        contextConfig
          ? writeCloudcodeContextState(sandbox, paths, {
              convexUrl: input.convexUrl,
              notesAccessToken: input.notesAccessToken,
              runId: input.runId,
              threadId: input.threadId,
            })
          : undefined
      )
      .then(() =>
        installDaytonaDesktopTools(sandbox, paths, input.signal, {
          config: mcpConfig,
          instructions: contextConfig
            ? cloudcodeContextAgentInstructions()
            : undefined,
        })
      )
      .then(() => runPathInstallScript(sandbox, input, paths, gitAuth))
      .then(() => runPresetInstallScript(sandbox, input, paths, gitAuth))

    await writeHotContinuationMarker({
      fingerprint: hotFingerprint,
      paths,
      sandbox,
      signal: input.signal,
    }).catch((error) =>
      emitLog(input, {
        detail: error instanceof Error ? compactLine(error.message) : undefined,
        kind: "setup",
        message: "Hot sandbox continuation marker was not updated",
      })
    )

    return await finishRun()
  } finally {
    stopDaytonaActivityHeartbeat?.()
    await stopDesktopAgentRecording()
    // Best effort only: once the signal is aborted these throw immediately,
    // and a throwing finally would replace the error already unwinding (e.g.
    // turning a cancel into a cleanup failure).
    await Promise.all([
      cleanupRunFiles(sandbox, paths, input.signal).catch(() => undefined),
      gitAuth?.cleanup().catch(() => undefined) ?? Promise.resolve(),
    ])
  }
}
